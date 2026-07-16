mod common;
use common::{send, LuxServer};

fn assert_has(resp: &str, needle: &str) {
    assert!(resp.contains(needle), "missing {needle:?}: {resp}");
}

// Commands that used to fake `+OK` must return an honest response of the correct
// RESP type (a real value, or a clear unsupported error) so clients aren't misled.
#[test]
fn stub_commands_return_honest_responses() {
    let server = LuxServer::start();
    let mut conn = server.conn();

    // WAIT reports 0 replicas as an integer (no replication), not +OK.
    assert_has(&send(&mut conn, &["WAIT", "0", "0"]), ":0");
    // COMMAND COUNT returns a real, non-zero integer count.
    let count = send(&mut conn, &["COMMAND", "COUNT"]);
    assert!(
        count.starts_with(':') && count.trim() != ":0",
        "COMMAND COUNT should be a real integer: {count:?}"
    );
    // COMMAND (bare) and COMMAND INFO return an array shape, not +OK.
    assert_has(&send(&mut conn, &["COMMAND"]), "*");
    assert_has(&send(&mut conn, &["COMMAND", "INFO", "GET"]), "*");
    // COMMAND GETKEYS can't be faked, so it errors rather than returning +OK.
    assert_has(
        &send(&mut conn, &["COMMAND", "GETKEYS", "SET", "k", "v"]),
        "-ERR",
    );
    // SELECT 0 is OK; other indexes and non-integers are honest errors.
    assert_has(&send(&mut conn, &["SELECT", "0"]), "+OK");
    assert_has(&send(&mut conn, &["SELECT", "1"]), "-ERR");
    assert_has(&send(&mut conn, &["SELECT", "notanint"]), "-ERR");
    // SWAPDB is unsupported (single database) rather than a fake OK.
    assert_has(&send(&mut conn, &["SWAPDB", "0", "1"]), "-ERR");
    // RESET replies with the +RESET status line.
    assert_has(&send(&mut conn, &["RESET"]), "+RESET");
    // LATENCY RESET is an integer; reporting forms are arrays.
    assert_has(&send(&mut conn, &["LATENCY", "RESET"]), ":0");
    assert_has(&send(&mut conn, &["LATENCY", "HISTORY", "event"]), "*0");
    // FUNCTION LIST is honestly empty; other subcommands are unsupported.
    assert_has(&send(&mut conn, &["FUNCTION", "LIST"]), "*0");
    assert_has(&send(&mut conn, &["FUNCTION", "STATS"]), "-ERR");
    // DUMP returns an unsupported error rather than a bogus payload.
    assert_has(&send(&mut conn, &["DUMP", "k"]), "-ERR");
}

#[test]
fn client_getname_and_setname_are_session_local() {
    let server = LuxServer::start();
    let mut conn = server.conn();
    let mut other = server.conn();

    assert_has(&send(&mut conn, &["CLIENT", "GETNAME"]), "$-1");
    assert_has(&send(&mut conn, &["CLIENT", "SETNAME", "worker-a"]), "+OK");
    assert_has(&send(&mut conn, &["CLIENT", "GETNAME"]), "worker-a");
    assert_has(&send(&mut other, &["CLIENT", "GETNAME"]), "$-1");
}

#[test]
fn client_setinfo_is_tolerated_for_ioredis() {
    let server = LuxServer::start();
    let mut conn = server.conn();

    assert_has(
        &send(&mut conn, &["CLIENT", "SETINFO", "LIB-NAME", "ioredis"]),
        "+OK",
    );
    assert_has(
        &send(&mut conn, &["CLIENT", "SETINFO", "LIB-VER", "5.0.0"]),
        "+OK",
    );
}

#[test]
fn info_reports_blocking_waiter_counters() {
    let server = LuxServer::start();
    let mut conn = server.conn();

    let info = send(&mut conn, &["INFO"]);
    assert_has(&info, "blocked_list_waiters:");
    assert_has(&info, "blocked_stream_waiters:");
}
