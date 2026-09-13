import { describe, expect, test } from 'vitest';
import enUS from '../../public/intl/messages/en-US.json';
import { labels, messages } from './messages';

function resolve(id: string) {
  return id.split('.').reduce<any>((node, part) => node?.[part], enUS);
}

describe('message ids', () => {
  test('every label id resolves to an en-US string', () => {
    const missing = Object.values(labels).filter(id => typeof resolve(id) !== 'string');

    expect(missing).toEqual([]);
  });

  test('every message id resolves to an en-US string', () => {
    const missing = Object.values(messages).filter(id => typeof resolve(id) !== 'string');

    expect(missing).toEqual([]);
  });
});
