'use strict';

/**
 * Build a Gemini-compatible contents array from DB history rows.
 *
 * Gemini has strict requirements:
 * 1. Roles must alternate: user → model → user → model
 * 2. All functionCalls from one round must be in a SINGLE model turn
 * 3. All functionResponses must be in a SINGLE user turn immediately after
 * 4. functionResponse turns can ONLY appear after functionCall turns
 * 5. First entry must be a user turn
 *
 * DB stores tool_call/tool_result rows individually and interleaved:
 *   tool_call(A), tool_result(A), tool_call(B), tool_result(B)
 * But Gemini needs them batched:
 *   model: [functionCall(A), functionCall(B)]
 *   user: [functionResponse(A), functionResponse(B)]
 *
 * This function handles that reordering + all edge cases.
 */
function buildGeminiContents(historyRows) {
  // Step 1: Reorder rows so consecutive tool sequences are batched
  // (all tool_calls first, then all tool_results)
  const reordered = [];
  let i = 0;
  while (i < historyRows.length) {
    if (historyRows[i].role === 'tool_call') {
      // Collect all consecutive tool_call/tool_result rows
      const calls = [];
      const results = [];
      while (i < historyRows.length &&
             (historyRows[i].role === 'tool_call' || historyRows[i].role === 'tool_result')) {
        if (historyRows[i].role === 'tool_call') calls.push(historyRows[i]);
        else results.push(historyRows[i]);
        i++;
      }
      // Emit all calls first, then all results
      calls.forEach(c => reordered.push(c));
      results.forEach(r => reordered.push(r));
    } else {
      reordered.push(historyRows[i]);
      i++;
    }
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
      // Only include if preceded by a model turn with functionCall
      const last = contents[contents.length - 1];
      if (!last || last.role !== 'model' || !last.parts.some(p => p.functionCall)) {
        continue; // Orphaned tool_result — skip
      }
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

  // Step 3: Trim invalid edges
  // First entry must be a user turn
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
