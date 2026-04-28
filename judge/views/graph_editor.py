from django.conf import settings
from django.utils.translation import gettext as _
from django.views.generic import TemplateView

from judge.utils.views import TitleMixin

__all__ = ["GraphEditorView", "ToolsListView"]


class ToolsListView(TitleMixin, TemplateView):
    template_name = "tools/list.html"
    title = _("Tools")


class GraphEditorView(TitleMixin, TemplateView):
    template_name = "tools/graph_editor.html"
    title = _("Graph Editor")

    def get_context_data(self, **kwargs):
        context = super().get_context_data(**kwargs)
        context["ge_node_dist"] = getattr(settings, "GRAPH_EDITOR_NODE_DIST", 112)
        context["ge_tension"] = getattr(settings, "GRAPH_EDITOR_TENSION", 1.6)
        context["ge_node_repulsion"] = getattr(settings, "GRAPH_EDITOR_NODE_REPULSION", 0.0)
        return context
