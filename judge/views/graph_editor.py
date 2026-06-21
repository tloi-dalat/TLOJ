from django.utils.translation import gettext_lazy as _
from django.views.generic import TemplateView

from judge.utils.views import TitleMixin

__all__ = ['GraphEditorView', 'GeometryWidgetView', 'ToolsListView']


class ToolsListView(TitleMixin, TemplateView):
    template_name = 'tools/list.html'
    title = _('Tools')


class GraphEditorView(TitleMixin, TemplateView):
    template_name = 'tools/graph_editor.html'
    title = _('Graph Editor')


class GeometryWidgetView(TitleMixin, TemplateView):
    template_name = 'tools/geometry_widget.html'
    title = _('Geometry Widget')

