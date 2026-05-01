from django.utils.translation import gettext as _
from django.views.generic import TemplateView

from judge.utils.views import TitleMixin


class ResolverToolView(TitleMixin, TemplateView):
    template_name = 'tools/resolver.html'
    title = _('Resolver Tool')
