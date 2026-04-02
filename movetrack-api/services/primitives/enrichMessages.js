'use strict';

/**
 * Enrich visible messages (user + model) with the tool actions that occurred
 * between them. Attaches an `actions` array to each model message.
 */
function enrichMessagesWithActions(allMessages) {
  const visibleMessages = allMessages.filter(m => m.role === 'user' || m.role === 'model');
  return visibleMessages.map((msg, idx) => {
    if (msg.role === 'model') {
      const prevVisibleIdx = idx > 0 ? allMessages.indexOf(visibleMessages[idx - 1]) : -1;
      const thisIdx = allMessages.indexOf(msg);
      const toolCalls = allMessages
        .slice(prevVisibleIdx + 1, thisIdx)
        .filter(m => m.role === 'tool_call')
        .map(tc => ({
          tool: tc.tool_name,
          args: tc.tool_args,
          result: allMessages.find(
            m => m.role === 'tool_result' && m.tool_name === tc.tool_name &&
                 allMessages.indexOf(m) > allMessages.indexOf(tc) && allMessages.indexOf(m) < thisIdx
          )?.tool_response,
        }));
      return { ...msg, actions: toolCalls };
    }
    return msg;
  });
}

module.exports = { enrichMessagesWithActions };
