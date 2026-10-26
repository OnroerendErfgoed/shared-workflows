"""Checks the services started by python-tests.yml.

SERVICES is a comma-separated list (postgres, redis, elasticsearch) set by the
self-test; the checks for other services are skipped.
"""
import json
import os
import socket
import urllib.request

import pytest

SERVICES = os.environ.get("SERVICES", "").split(",")


def requires(service):
    return pytest.mark.skipif(service not in SERVICES, reason=f"{service} not started")


@requires("postgres")
def test_postgres_accepts_connections():
    with socket.create_connection(("localhost", 5432), timeout=5):
        pass


@requires("redis")
def test_redis_answers_ping():
    with socket.create_connection(("localhost", 6379), timeout=5) as conn:
        conn.sendall(b"PING\r\n")
        assert conn.recv(16) == b"+PONG\r\n"


@requires("elasticsearch")
def test_elasticsearch_version():
    with urllib.request.urlopen("http://localhost:9200", timeout=10) as response:
        info = json.load(response)
    assert info["version"]["number"] == os.environ["ELASTICSEARCH_VERSION"]
