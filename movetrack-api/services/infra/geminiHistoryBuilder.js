'use strict';

/**
 * Build a Gemini-compatible contents array from DB history rows.
 *
 * Gemini has strict requirements:
 * 1. Roles must alternate: user → model → user → model
 * 2. All functionCalls from one round must be in a SINGLE model turn
 * 3. All functionResponses must be in a SINGLE user turn immediately after,
 *    with one response per call (Gemini 400s on any mismatch:
 *    "Please ensure that function response turn comes immediately after a
 *    function call turn.")
 * 4. functionResponse turns can ONLY appear after functionCall turns
 * 5. First entry must be a user turn
 *
 * nexus_messages has MULTIPLE CONCURRENT WRITERS — the live chat turn, the
 * async scan-job worker (marker rows), and the /inventory/commit route
 * (recorded tool pairs) — so rows can interleave inside a tool_call →
 * tool_result span, and a crash between the two inserts can orphan a call
 * forever. History is rebuilt from the DB on every turn, so a single bad row
 * would otherwise poison the session permanently. This builder therefore
 * repairs, not just reorders: interlopers are moved out of tool spans, and a
 * final pass drops any call/response that cannot be validly paired.
 */
function buildGeminiContents(historyRows) {
  // Step 1: Reorder rows so tool sequences are batched (all tool_calls first,
  // then all tool_results). A non-tool row that lands INSIDE an unbalanced
  // span (concurrent writer) is deferred until after the pair; once the span
  // is balanced, the batch ends and subsequent rows stay in place.
  const reordered = [];
  let i = 0;
  while (i < historyRows.length) {
    if (historyRows[i].role !== 'tool_call') {
      reordered.push(historyRows[i]);
      i++;
      continue;
    }
    const calls = [];
    const results = [];
    const deferred = [];
    while (i < historyRows.length) {
      const row = historyRows[i];
      if (row.role === 'tool_call') {
        calls.push(row);
      } else if (row.role === 'tool_result') {
        results.push(row);
      } else if (results.length < calls.length) {
        deferred.push(row); // interloper inside the span — move it after
      } else {
        break; // balanced and a non-tool row follows — batch complete
      }
      i++;
    }
    reordered.push(...calls, ...results, ...deferred);
  }

  // Step 2: Build contents with role merging
  const contents = [];
  for (const row of reordered) {
    let role, part;
    if (row.role === 'user') {
      role = 'user';
      part = { text: row.content || '(empty)' };
    } else if (row.role === 'model') {
      role = 'model';
      part = { text: row.content || '' };
    } else if (row.role === 'tool_call') {
      role = 'model';
      part = { functionCall: { name: row.tool_name, args: row.tool_args || {} } };
    } else if (row.role === 'tool_result') {
      role = 'user';
      // Truncate large vision tool responses to prevent context bloat
      let responseData = row.tool_response || {};
      if (row.tool_name === 'analyze_photo' || row.tool_name === 'analyze_video') {
        const responseStr = typeof responseData === 'string' ? responseData : JSON.stringify(responseData);
        if (responseStr.length > 2000) {
          try {
            const parsed = typeof responseData === 'string' ? JSON.parse(responseData) : responseData;
            const items = parsed.items || (parsed.item ? [parsed.item] : []);
            responseData = {
              success: parsed.success,
              mode: parsed.mode,
              itemCount: items.length,
              items_summary: items.map(i => ({ name: i.name, confidence: i.confidence, picture_url: i.picture_url })),
              _truncated: true,
            };
          } catch (_) { /* keep original if parse fails */ }
        }
      }
      part = { functionResponse: { name: row.tool_name, response: responseData } };
    } else {
      continue;
    }

    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts.push(part);
    } else {
      contents.push({ role, parts: [part] });
    }
  }

  // Step 2.5: Enforce the call/response invariant EVERYWHERE, not just at the
  // edges. Pair each model turn's functionCalls with same-named responses in
  // the immediately following user turn; drop whatever cannot pair (an
  // orphaned call whose result was never written, a response whose call fell
  // outside the history window). Run twice: removing an empty turn can merge
  // neighbors and expose a new mismatch.
  for (let pass = 0; pass < 2; pass++) {
    for (let t = 0; t < contents.length; t++) {
      const turn = contents[t];
      if (turn.role === 'model') {
        if (!turn.parts.some(p => p.functionCall)) continue;
        const next = contents[t + 1];
        const available = [];
        if (next && next.role === 'user') {
          for (const p of next.parts) {
            if (p.functionResponse) available.push(p.functionResponse.name);
          }
        }
        // Keep only calls with a matching response (multiset by name)
        turn.parts = turn.parts.filter(p => {
          if (!p.functionCall) return true;
          const idx = available.indexOf(p.functionCall.name);
          if (idx === -1) return false;
          available.splice(idx, 1);
          return true;
        });
        // Whatever names remain in `available` are responses with no call
        if (next && next.role === 'user' && available.length > 0) {
          next.parts = next.parts.filter(p => {
            if (!p.functionResponse) return true;
            const idx = available.indexOf(p.functionResponse.name);
            if (idx === -1) return true;
            available.splice(idx, 1);
            return false;
          });
        }
      } else if (turn.role === 'user' && turn.parts.some(p => p.functionResponse)) {
        const prev = contents[t - 1];
        if (!prev || prev.role !== 'model' || !prev.parts.some(p => p.functionCall)) {
          turn.parts = turn.parts.filter(p => !p.functionResponse);
        }
      }
    }
    // Remove turns emptied by the filtering, then merge same-role neighbors
    // the removals created.
    for (let t = contents.length - 1; t >= 0; t--) {
      if (contents[t].parts.length === 0) contents.splice(t, 1);
    }
    for (let t = contents.length - 1; t >= 1; t--) {
      if (contents[t].role === contents[t - 1].role) {
        contents[t - 1].parts.push(...contents[t].parts);
        contents.splice(t, 1);
      }
    }
  }

  // Step 3: Trim invalid edges
  // First entry must be a user turn. A leading plain-text model turn is real
  // context (the seeded greeting, a mirrored confirmation) — losing it made
  // the model re-ask for the name the user had just given. Keep it by
  // bootstrapping a synthetic user turn in front. This is safe for
  // functionCall turns too: step 2.5 already removed any call that isn't
  // immediately followed by its response, so a leading call turn is always a
  // complete pair — shifting it off would orphan the response behind it.
  if (contents.length > 0 && contents[0].role === 'model') {
    contents.unshift({ role: 'user', parts: [{ text: '[The user opened the app.]' }] });
  }
  while (contents.length > 0 && contents[0].role !== 'user') {
    contents.shift();
  }
  // After shifting, first entry might be a functionResponse without preceding functionCall — drop it too
  while (contents.length > 0 && contents[0].role === 'user' &&
         contents[0].parts.every(p => p.functionResponse)) {
    contents.shift();
  }
  // Last entry shouldn't be an orphaned functionCall
  while (contents.length > 0) {
    const lastEntry = contents[contents.length - 1];
    if (lastEntry.role === 'model' && lastEntry.parts.every(p => p.functionCall)) {
      contents.pop();
    } else {
      break;
    }
  }

  return contents;
}

module.exports = { buildGeminiContents };
