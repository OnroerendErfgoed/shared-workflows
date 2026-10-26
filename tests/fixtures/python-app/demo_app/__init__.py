from pyramid.config import Configurator


def hello(request):
    return {"message": f"Hello {request.params.get('name', 'world')}"}


def main(global_config=None, **settings):
    with Configurator(settings=settings) as config:
        config.add_route("hello", "/")
        config.add_view(hello, route_name="hello", renderer="json")
        return config.make_wsgi_app()
