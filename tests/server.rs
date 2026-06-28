mod common;
use common::{send, LuxServer};

fn assert_has(resp: &str, needle: &str) {
    assert!(resp.contains(needle), "missing {needle:?}: {resp}");
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
