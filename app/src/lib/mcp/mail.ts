/**
 * Logged-in mailbox reads. SQL matches the dashboard, settings page, and
 * `GET /api/getMails`: D1 `MAIL_DB` rows owned by the Clerk `user_id`.
 * Anonymous KV mail (`POST_DB`, `/api/get`) is not read here.
 */

export interface MailDb {
    prepare(sql: string): {
        bind(...values: unknown[]): {
            run(): Promise<{ results?: Record<string, unknown>[] }>;
        };
    };
}

export type Mailbox = {
    id: number;
    email_address: string;
    alias: string;
    created_at: string;
};

/** Message list row. Body is omitted so a client can choose one `message_id` to read. */
export type MailSummary = {
    message_id: string;
    subject: string;
    sender: string;
    senderName: string;
    cc: string;
    received_at: string;
    is_read: number;
};

/** Same shape as `MailsList` / `GET /api/getMails` items, including `content`. */
export type MailMessage = MailSummary & {
    content: string;
};

export type MailError = { error: string };

export function isMailError(value: { error: string } | object): value is MailError {
    return 'error' in value && typeof value.error === 'string';
}

function text(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function integer(value: unknown): number {
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
}

async function query(
    db: MailDb,
    sql: string,
    params: unknown[],
): Promise<Record<string, unknown>[] | MailError> {
    try {
        const result = await db.prepare(sql).bind(...params).run();
        return result.results ?? [];
    } catch (error) {
        console.error('MCP mail query failed', error);
        return { error: 'Could not read mail.' };
    }
}

export async function listMailboxes(db: MailDb, userId: string): Promise<{ mailboxes: Mailbox[] } | MailError> {
    if (!userId) return { error: 'Sign in is required.' };
    const rows = await query(
        db,
        'SELECT id, email_address, alias, created_at FROM user_email_addresses WHERE user_id = ? ORDER BY id ASC',
        [userId],
    );
    if (isMailError(rows)) return rows;
    return {
        mailboxes: rows.map((row) => ({
            id: integer(row.id),
            email_address: text(row.email_address),
            alias: text(row.alias),
            created_at: text(row.created_at),
        })),
    };
}

export async function listMessages(
    db: MailDb,
    userId: string,
    mailboxId: number,
): Promise<{ mailbox_id: number; messages: MailSummary[] } | MailError> {
    if (!userId) return { error: 'Sign in is required.' };
    if (!Number.isInteger(mailboxId) || mailboxId <= 0) return { error: 'Mailbox not found.' };

    const owned = await query(
        db,
        'SELECT id FROM user_email_addresses WHERE user_id = ? AND id = ?',
        [userId, mailboxId],
    );
    if (isMailError(owned)) return owned;
    if (owned.length === 0) return { error: 'Mailbox not found.' };

    const rows = await query(
        db,
        `SELECT e.message_id, e.subject, e.sender, e.sender_name, e.cc, e.received_at, es.is_read
         FROM emails e
         JOIN email_status es ON es.email_id = e.id
         WHERE e.user_email_id = ? AND es.user_id = ?
         ORDER BY e.received_at DESC`,
        [mailboxId, userId],
    );
    if (isMailError(rows)) return rows;
    return {
        mailbox_id: mailboxId,
        messages: rows.map(toSummary),
    };
}

export async function getMessage(
    db: MailDb,
    userId: string,
    messageId: string,
): Promise<{ message: MailMessage } | MailError> {
    if (!userId) return { error: 'Sign in is required.' };
    if (!messageId || messageId.length > 2000) return { error: 'Email not found.' };

    const rows = await query(
        db,
        `SELECT e.message_id, e.subject, e.cc, e.sender_name, e.sender, e.body_text, e.body_html, e.received_at, es.is_read
         FROM emails e
         JOIN email_status es ON es.email_id = e.id
         JOIN user_email_addresses uea ON e.user_email_id = uea.id
         WHERE e.message_id = ? AND uea.user_id = ? AND es.user_id = ?`,
        [messageId, userId, userId],
    );
    if (isMailError(rows)) return rows;
    const row = rows[0];
    if (!row) return { error: 'Email not found.' };
    return {
        message: {
            ...toSummary(row),
            content: text(row.body_text) || text(row.body_html),
        },
    };
}

function toSummary(row: Record<string, unknown>): MailSummary {
    return {
        message_id: text(row.message_id),
        subject: text(row.subject),
        sender: text(row.sender),
        senderName: text(row.sender_name),
        cc: text(row.cc),
        received_at: text(row.received_at),
        is_read: integer(row.is_read),
    };
}
