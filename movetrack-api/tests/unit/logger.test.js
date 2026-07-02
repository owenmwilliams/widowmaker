'use strict';

const { createLogger } = require('../../services/infra/logger');

describe('createLogger', () => {
  let logSpy, warnSpy, errorSpy;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test('info() emits a single JSON line on console.log with severity INFO', () => {
    createLogger({ component: 'test' }).info('hello');
    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.severity).toBe('INFO');
    expect(parsed.message).toBe('hello');
    expect(parsed.component).toBe('test');
    expect(typeof parsed.time).toBe('string');
  });

  test('warn() routes to console.warn with severity WARNING', () => {
    createLogger().warn('careful');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warnSpy.mock.calls[0][0]).severity).toBe('WARNING');
  });

  test('error() routes to console.error with severity ERROR', () => {
    createLogger().error('broken');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(errorSpy.mock.calls[0][0]).severity).toBe('ERROR');
  });

  test('carries bound fields (user/session/request id) on every call', () => {
    const log = createLogger({ userId: 'u1', sessionId: 's1', requestId: 'r1' });
    log.info('turn started');
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed).toMatchObject({ userId: 'u1', sessionId: 's1', requestId: 'r1' });
  });

  test('child() layers on additional fields without mutating the parent', () => {
    const parent = createLogger({ userId: 'u1' });
    const child = parent.child({ sessionId: 's1' });

    child.info('child event');
    parent.info('parent event');

    const childPayload = JSON.parse(logSpy.mock.calls[0][0]);
    const parentPayload = JSON.parse(logSpy.mock.calls[1][0]);
    expect(childPayload).toMatchObject({ userId: 'u1', sessionId: 's1' });
    expect(parentPayload.sessionId).toBeUndefined();
  });

  test('per-call extra fields override bound fields', () => {
    createLogger({ tool: 'add_item' }).info('overridden', { tool: 'add_items' });
    expect(JSON.parse(logSpy.mock.calls[0][0]).tool).toBe('add_items');
  });
});
