import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createMailbox, deleteMailbox, generateMailboxAddress, getMessage, listMailboxes, listMessages, type MailDb } from './mail.ts';

type Call = { sql: string; params: unknown[] };
type RunResult = { results?: Record<string, unknown>[]; meta?: { changes?: number } };

function createDb(respond: (sql: string, params: unknown[]) => RunResult | Record<string, unknown>[]): { db: MailDb; calls: Call[] } {
    const calls: Call[] = [];
    const db: MailDb = {
        prepare(sql) {
            return {
                bind(...params) {
                    return {
                        async run() {
                            calls.push({ sql, params });
                            const result = respond(sql, params);
                            return Array.isArray(result) ? { results: result } : result;
                        },
                    };
                },
            };
        },
        async batch(statements) {
            const results = [];
            for (const statement of statements) results.push(await statement.run());
            return results;
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
            async batch() {
                throw new Error('d1 down');
            },
        };
        const result = await listMailboxes(db, 'user_owner');
        assert.deepEqual(result, { error: 'Could not read mail.' });
    });

    it('generates an address with two short words and does not take a local-part', () => {
        for (let i = 0; i < 20; i++) {
            assert.match(generateMailboxAddress(), /^[a-z]{1,5}\.[a-z]{1,5}\d{1,3}@fakeact\.fun$/);
        }
    });

    it('returns the created mailbox, including the database id and timestamp', async () => {
        const { db, calls } = createDb((sql) => {
            if (sql.startsWith('SELECT count')) return [{ 'count(*)': 1 }];
            if (sql.startsWith('INSERT')) return [];
            return [{
                id: 9,
                email_address: 'red.oak12@fakeact.fun',
                alias: 'signup',
                created_at: '2026-02-02 00:00:00',
            }];
        });
        const result = await createMailbox(db, 'user_owner', 'signup', () => 'red.oak12@fakeact.fun');
        assert.deepEqual(result, {
            mailbox: {
                id: 9,
                email_address: 'red.oak12@fakeact.fun',
                alias: 'signup',
                created_at: '2026-02-02 00:00:00',
            },
        });
        assert.deepEqual(calls[0].params, ['user_owner']);
        assert.match(calls[0].sql, /user_email_addresses/);
        assert.match(calls[1].sql, /INSERT INTO user_email_addresses/);
        assert.deepEqual(calls[1].params, ['user_owner', 'red.oak12@fakeact.fun', 'signup']);
        assert.match(calls[2].sql, /user_id = \? AND email_address = \?/);
        assert.deepEqual(calls[2].params, ['user_owner', 'red.oak12@fakeact.fun']);
    });

    it('rejects a sixth mailbox and an alias longer than 400 characters', async () => {
        const limited = createDb(() => [{ 'count(*)': 5 }]);
        const overLimit = await createMailbox(limited.db, 'user_owner', 'notes', () => 'red.oak12@fakeact.fun');
        assert.deepEqual(overLimit, { error: "You can't create more than 5 accounts!" });
        assert.equal(limited.calls.length, 1);
        assert.doesNotMatch(limited.calls[0].sql, /INSERT/i);

        const tooLong = createDb(() => []);
        const rejected = await createMailbox(tooLong.db, 'user_owner', 'x'.repeat(401));
        assert.deepEqual(rejected, { error: 'remark is too long!' });
        assert.equal(tooLong.calls.length, 0);
    });

    it('returns the generate error when the insert fails', async () => {
        const { db, calls } = createDb((sql) => {
            if (sql.startsWith('SELECT count')) return [{ 'count(*)': 0 }];
            throw new Error('unique');
        });
        const result = await createMailbox(db, 'user_owner', '', () => 'red.oak12@fakeact.fun');
        assert.deepEqual(result, { error: 'Something wrong or exists, please try again!' });
        assert.equal(calls.length, 2);
        assert.doesNotMatch(calls.map((call) => call.sql).join('\n'), /SELECT id/);
    });

    it('does not delete a mailbox the user does not own', async () => {
        const { db, calls } = createDb(() => []);
        const result = await deleteMailbox(db, 'user_owner', 2);
        assert.deepEqual(result, { error: 'Mailbox not found.' });
        assert.equal(calls.length, 1);
        assert.doesNotMatch(calls[0].sql, /DELETE/i);
        assert.deepEqual(calls[0].params, ['user_owner', 2]);
    });

    it('deletes only that user\'s mailbox, messages, status, and tag relations', async () => {
        const { db, calls } = createDb((sql) => {
            if (sql.startsWith('SELECT')) return [{ id: 7 }];
            if (sql.startsWith('DELETE FROM user_email_addresses')) return { results: [], meta: { changes: 1 } };
            return [];
        });
        const result = await deleteMailbox(db, 'user_owner', 7);
        assert.deepEqual(result, { deleted: true, id: 7 });
        const deletes = calls.slice(1);
        assert.deepEqual(deletes.map((call) => call.sql.replace(/\s+/g, ' ').trim()), [
            'DELETE FROM email_tag_relations WHERE email_id IN (SELECT e.id FROM emails e JOIN user_email_addresses uea ON e.user_email_id = uea.id WHERE uea.user_id = ? AND uea.id = ?)',
            'DELETE FROM email_status WHERE user_id = ? AND email_id IN (SELECT e.id FROM emails e JOIN user_email_addresses uea ON e.user_email_id = uea.id WHERE uea.user_id = ? AND uea.id = ?)',
            'DELETE FROM emails WHERE user_email_id IN (SELECT id FROM user_email_addresses WHERE user_id = ? AND id = ?)',
            'DELETE FROM user_email_addresses WHERE user_id = ? AND id = ?',
        ]);
        assert.deepEqual(deletes[0].params, ['user_owner', 7]);
        assert.deepEqual(deletes[1].params, ['user_owner', 'user_owner', 7]);
        assert.deepEqual(deletes[2].params, ['user_owner', 7]);
        assert.deepEqual(deletes[3].params, ['user_owner', 7]);
        assert.equal(calls.some((call) => /email_tags\b/.test(call.sql) && !call.sql.includes('email_tag_relations')), false);
    });

    it('does not report success when the owned mailbox row was not removed', async () => {
        const { db } = createDb((sql) => {
            if (sql.startsWith('SELECT')) return [{ id: 7 }];
            if (sql.startsWith('DELETE FROM user_email_addresses')) return { results: [], meta: { changes: 0 } };
            return [];
        });
        const result = await deleteMailbox(db, 'user_owner', 7);
        assert.deepEqual(result, { error: 'Mailbox not found.' });
    });

    it('returns a delete error when the batch throws', async () => {
        const { db } = createDb((sql) => {
            if (sql.startsWith('SELECT')) return [{ id: 7 }];
            throw new Error('d1 down');
        });
        const result = await deleteMailbox(db, 'user_owner', 7);
        assert.deepEqual(result, { error: 'Could not delete mailbox.' });
    });
});
