from django.utils.translation import gettext as _
from django.views.generic import TemplateView

from judge.utils.views import TitleMixin


class ToolsListView(TitleMixin, TemplateView):
    template_name = 'tools/list.html'
    title = _('Tools')
