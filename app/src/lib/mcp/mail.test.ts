import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getMessage, listMailboxes, listMessages, type MailDb } from './mail.ts';

type Call = { sql: string; params: unknown[] };

function createDb(respond: (sql: string, params: unknown[]) => Record<string, unknown>[]): { db: MailDb; calls: Call[] } {
    const calls: Call[] = [];
    const db: MailDb = {
        prepare(sql) {
            return {
                bind(...params) {
                    return {
                        async run() {
                            calls.push({ sql, params });
                            return { results: respond(sql, params) };
                        },
                    };
                },
            };
        },
    };
    return { db, calls };
}

describe('logged-in mail queries', () => {
    it('lists only the bound user mailboxes', async () => {
        const { db, calls } = createDb(() => [{
            id: 7,
            email_address: 'owner.box@example.test',
            alias: 'Owner',
            created_at: '2026-01-01 00:00:00',
        }]);
        const result = await listMailboxes(db, 'user_owner');
        assert.deepEqual(result, {
            mailboxes: [{
                id: 7,
                email_address: 'owner.box@example.test',
                alias: 'Owner',
                created_at: '2026-01-01 00:00:00',
            }],
        });
        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, /user_id = \?/);
        assert.deepEqual(calls[0].params, ['user_owner']);
    });

    it('does not list messages for a mailbox the user does not own', async () => {
        const { db, calls } = createDb(() => []);
        const result = await listMessages(db, 'user_owner', 2);
        assert.deepEqual(result, { error: 'Mailbox not found.' });
        assert.equal(calls.length, 1);
        assert.match(calls[0].sql, /user_email_addresses/);
        assert.deepEqual(calls[0].params, ['user_owner', 2]);
    });

    it('lists message metadata without selecting the body', async () => {
        const { db, calls } = createDb((sql) => {
            if (sql.includes('user_email_addresses')) return [{ id: 7 }];
            return [{
                message_id: 'msg-sample',
                subject: 'Hello',
                sender: 'sender@example.test',
                sender_name: 'Sender',
                cc: '',
                received_at: '2026-01-03T00:00:00.000Z',
                is_read: 0,
                body_text: 'this column must not be selected',
            }];
        });
        const result = await listMessages(db, 'user_owner', 7);
        assert.deepEqual(result, {
            mailbox_id: 7,
            messages: [{
                message_id: 'msg-sample',
                subject: 'Hello',
                sender: 'sender@example.test',
                senderName: 'Sender',
                cc: '',
                received_at: '2026-01-03T00:00:00.000Z',
                is_read: 0,
            }],
        });
        const messageSql = calls[1].sql;
        assert.doesNotMatch(messageSql, /body_text|body_html/);
        assert.deepEqual(calls[1].params, [7, 'user_owner']);
    });

    it('returns the plain-text body for a message owned by the user', async () => {
        const { db, calls } = createDb(() => [{
            message_id: 'msg-sample',
            subject: 'Hello',
            sender: 'sender@example.test',
            sender_name: 'Sender',
            cc: 'cc@example.test',
            body_text: 'Fake sample body for tests.',
            body_html: '<p>not used when text exists</p>',
            received_at: '2026-01-03T00:00:00.000Z',
            is_read: 1,
        }]);
        const result = await getMessage(db, 'user_owner', 'msg-sample');
        assert.deepEqual(result, {
            message: {
                message_id: 'msg-sample',
                subject: 'Hello',
                sender: 'sender@example.test',
                senderName: 'Sender',
                cc: 'cc@example.test',
                content: 'Fake sample body for tests.',
                received_at: '2026-01-03T00:00:00.000Z',
                is_read: 1,
            },
        });
        assert.match(calls[0].sql, /uea\.user_id = \?/);
        assert.deepEqual(calls[0].params, ['msg-sample', 'user_owner', 'user_owner']);
    });

    it('falls back to HTML when the plain-text body is empty', async () => {
        const { db } = createDb(() => [{
            message_id: 'msg-html',
            subject: '',
            sender: 'sender@example.test',
            sender_name: '',
            cc: '',
            body_text: '',
            body_html: '<p>Fake HTML sample.</p>',
            received_at: '2026-01-03T00:00:00.000Z',
            is_read: 0,
        }]);
        const result = await getMessage(db, 'user_owner', 'msg-html');
        assert.equal('message' in result && result.message.content, '<p>Fake HTML sample.</p>');
    });

    it('does not return another user message when the query is empty', async () => {
        const { db } = createDb(() => []);
        const result = await getMessage(db, 'user_owner', 'msg-other');
        assert.deepEqual(result, { error: 'Email not found.' });
    });

    it('returns a read error when D1 throws', async () => {
        const db: MailDb = {
            prepare() {
                return {
                    bind() {
                        return {
                            async run() {
                                throw new Error('d1 down');
                            },
                        };
                    },
                };
            },
        };
        const result = await listMailboxes(db, 'user_owner');
        assert.deepEqual(result, { error: 'Could not read mail.' });
    });
});
