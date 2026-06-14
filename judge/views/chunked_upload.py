from chunked_upload.constants import http_status
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.views import ChunkedUploadCompleteView, ChunkedUploadView
from django.contrib.auth.decorators import login_required
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils.translation import gettext as _

from judge.models import Problem
from judge.tasks import reassemble_problem_data_zip

__all__ = ('ProblemDataChunkedUploadView', 'ProblemDataChunkedUploadCompleteView',
           'PolygonChunkedUploadView', 'PolygonChunkedUploadCompleteView')


class ProblemDataPermissionMixin:
    model = ChunkedUpload

    def get_queryset(self, request):
        return self.model.objects.filter(user=request.user)

    def validate(self, request):
        problem = get_object_or_404(Problem, code=self.kwargs['problem'])
        if not problem.is_editable_by(request.user):
            raise ChunkedUploadError(status=http_status.HTTP_403_FORBIDDEN,
                                     detail=_('You cannot edit this problem.'))


@method_decorator(login_required, name='dispatch')
class ProblemDataChunkedUploadView(ProblemDataPermissionMixin, ChunkedUploadView):
    field_name = 'file'


@method_decorator(login_required, name='dispatch')
class ProblemDataChunkedUploadCompleteView(ProblemDataPermissionMixin, ChunkedUploadCompleteView):
    do_md5_check = False

    def get_response_data(self, chunked_upload, request):
        task = reassemble_problem_data_zip.delay(chunked_upload.upload_id, self.kwargs['problem'])
        return {'task_id': task.id, 'upload_id': chunked_upload.upload_id}


class PolygonPermissionMixin:
    model = ChunkedUpload

    def get_queryset(self, request):
        return self.model.objects.filter(user=request.user)

    def validate(self, request):
        if not request.user.has_perm('judge.import_polygon_package'):
            raise ChunkedUploadError(status=http_status.HTTP_403_FORBIDDEN,
                                     detail=_('You cannot import Polygon packages.'))


@method_decorator(login_required, name='dispatch')
class PolygonChunkedUploadView(PolygonPermissionMixin, ChunkedUploadView):
    field_name = 'file'


@method_decorator(login_required, name='dispatch')
class PolygonChunkedUploadCompleteView(PolygonPermissionMixin, ChunkedUploadCompleteView):
    do_md5_check = False

    def get_response_data(self, chunked_upload, request):
        return {'upload_id': chunked_upload.upload_id}
