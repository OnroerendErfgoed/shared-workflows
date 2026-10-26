from pyramid import testing

from demo_app import hello, main


def test_hello():
    request = testing.DummyRequest(params={"name": "Erfgoed"})
    assert hello(request) == {"message": "Hello Erfgoed"}


def test_main_returns_wsgi_app():
    app = main()
    assert callable(app)
