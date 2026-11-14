"""Authorized, offline attack regression. All upstream requests are replaced.

Run with the isolated security tool environment, never against school systems.
Schemathesis generates malformed JSON; Hypothesis minimizes failing examples.
"""
import logging
import os
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
import schemathesis
from hypothesis import given, settings, strategies as st

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as service

ROUTES = ["/api/timetable/query", "/api/timetable/auto", "/api/learning/chaoxing/query"]
SPEC = {
    "openapi": "3.0.3", "info": {"title": "OHU offline security contract", "version": "150"},
    "paths": {path: {"post": {
        "requestBody": {"required": True, "content": {"application/json": {
            "schema": {"oneOf": [
                {"type": "object", "additionalProperties": True, "maxProperties": 10},
                {"type": "array", "items": {"type": "integer"}, "maxItems": 5},
                {"type": "string", "maxLength": 80}, {"type": "integer"}, {"type": "boolean"},
            ]}}}},
        "responses": {str(status): {"description": "bounded result"}
                      for status in [200, 400, 401, 413, 415, 422, 429, 501, 502, 503, 504]},
    }} for path in ROUTES},
}


if "security150_schema" not in service.app.view_functions:
    # Test-process-only route. It is not part of app.py or the production image.
    service.app.add_url_rule("/__offline_security150_schema", "security150_schema", lambda: SPEC)
schema = schemathesis.openapi.from_wsgi("/__offline_security150_schema", service.app)


@pytest.fixture(autouse=True)
def offline_only():
    with patch.dict(os.environ, {"CHAOXING_READ_ENABLED": "1"}), \
         patch.object(service, "MOCK", False), \
         patch("requests.sessions.Session.request", side_effect=AssertionError("Live upstream access forbidden")), \
         patch.object(service, "query_academic", return_value={"rows": []}), \
         patch.object(service, "auto_query_academic", return_value={"rows": []}), \
         patch("chaoxing_read.query_chaoxing", return_value={"courses": [], "homework": []}), \
         patch("captcha_ocr.ocr_available", return_value=True), \
         patch.object(service, "_enter_upstream", return_value=True), \
         patch.object(service, "_leave_upstream"), \
         patch.object(service, "_win_global_query", service._SlidingWindow(100000)), \
         patch.object(service, "_win_username", service._SlidingWindow(100000)), \
         patch.object(service, "_win_ip_query", service._SlidingWindow(100000)):
        service.app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)
        logging.disable(logging.CRITICAL)  # Synthetic payloads need not enter logs.
        yield
        logging.disable(logging.NOTSET)


@schema.parametrize()
@settings(max_examples=80, deadline=None, database=None, derandomize=True)
def test_schemathesis_malformed_requests_never_crash(case):
    response = case.call()
    assert response.status_code != 500
    assert response.headers.get("x-content-type-options") == ["nosniff"]
    assert "no-store" in response.headers.get("cache-control", [""])[0]


@pytest.mark.parametrize("path", ROUTES[:3])
@pytest.mark.parametrize("payload", [[1], True, 2, "not-an-object"])
def test_non_object_json_is_rejected_before_upstream(path, payload):
    response = service.app.test_client().post(path, json=payload)
    assert response.status_code == 400
    service.auto_query_academic.assert_not_called()
    service.query_academic.assert_not_called()


@pytest.mark.parametrize("value", ["NaN", {}, [], 1.5, True, "9" * 100])
def test_ocr_attempts_cannot_crash_or_amplify(value):
    r = service.app.test_client().post("/api/timetable/auto", json={
        "username": "synthetic-user", "password": "synthetic-password", "max_tries": value})
    assert r.status_code == 400
    service.auto_query_academic.assert_not_called()


@given(st.ip_addresses(v=4).map(str))
@settings(max_examples=40, database=None, derandomize=True)
def test_untrusted_client_cannot_choose_rate_limit_identity(forged):
    with patch.object(service, "TRUSTED_PROXY_HOPS", 0, create=True):
        with service.app.test_request_context("/", headers={"X-Forwarded-For": forged, "X-Real-IP": forged},
                                              environ_base={"REMOTE_ADDR": "192.0.2.5"}):
            assert service._client_ip() == "192.0.2.5"


def test_proxy_headers_need_trusted_peer_and_use_the_right_hand_hop():
    from request_security import client_ip
    assert client_ip("192.0.2.5", "198.51.100.1", 1, "10.0.0.0/8") == "192.0.2.5"
    assert client_ip("10.0.0.2", "198.51.100.99, 192.0.2.5", 1, "10.0.0.0/8") == "192.0.2.5"
    assert client_ip("10.0.0.2", "bad-value", 1, "10.0.0.0/8") == "10.0.0.2"
    assert client_ip("10.0.0.2", "192.0.2.5", 2, "10.0.0.0/8") == "10.0.0.2"
    assert client_ip("10.0.0.2", "192.0.2.5", 1, "invalid") == "10.0.0.2"


@pytest.mark.parametrize("path", ROUTES)
def test_credential_bodies_are_bounded_and_private(path):
    r = service.app.test_client().post(path, json={"padding": "x" * 9000})
    assert r.status_code == 413
    assert "no-store" in r.headers.get("Cache-Control", "")
    assert r.is_json


@pytest.mark.parametrize("path", ["/api/timetable/auto", "/api/timetable/query"])
def test_wrong_field_types_do_not_become_upstream_credentials(path):
    key = "username"
    r = service.app.test_client().post(path, json={key: {"$ne": None}, "password": ["synthetic"], "captcha": "1234", "sid": "synthetic"})
    assert r.status_code == 400
    service.auto_query_academic.assert_not_called()
    service.query_academic.assert_not_called()


@pytest.mark.parametrize("path", ["/../.env", "/%2e%2e/.env", "/api/../../app.py"])
def test_path_traversal_cannot_read_source_or_configuration(path):
    r = service.app.test_client().get(path)
    assert r.status_code in (400, 404)
    assert b"CLOUDBASE_API_KEY" not in r.data


def test_upstream_failure_cannot_dump_private_exception_into_logs(caplog):
    logging.disable(logging.NOTSET)
    marker = "synthetic-private-exception-marker"
    with patch.object(service, "auto_query_academic", side_effect=RuntimeError(marker)):
        with caplog.at_level(logging.WARNING):
            r = service.app.test_client().post("/api/timetable/auto", json={
                "username": "synthetic-user", "password": "synthetic-password"})
    assert r.status_code == 500
    assert marker not in caplog.text
    assert marker.encode() not in r.data
    assert "no-store" in r.headers["Cache-Control"]


def test_resetting_noncryptographic_prng_does_not_repeat_rsa_padding():
    import random
    from Crypto.PublicKey import RSA
    from jou_client import zf_rsa_encrypt
    key = RSA.generate(1024)
    random.seed(150)
    first = zf_rsa_encrypt("synthetic-only", format(key.e, "x"), format(key.n, "x"))
    random.seed(150)
    second = zf_rsa_encrypt("synthetic-only", format(key.e, "x"), format(key.n, "x"))
    assert first != second


def test_valid_academic_contract_survives_security_checks():
    r = service.app.test_client().post("/api/timetable/query", json={
        "username": "synthetic-user", "password": "synthetic-password", "captcha": "1234", "sid": "synthetic-session",
        "fetch": ["schedule", "grades", "exams"]})
    assert r.status_code == 200
    assert r.get_json()["ok"] is True
    service.query_academic.assert_called_once_with("synthetic-session", "synthetic-user", "synthetic-password", "1234",
                                                 fetch=["schedule", "grades", "exams"])
