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
    """Restrict chunked uploads to users who can edit the target problem.

    The target problem ``code`` comes from the URL, so we re-check edit
    permission on every chunk and on completion rather than trusting the upload
    session alone.
    """
    model = ChunkedUpload

    def get_queryset(self, request):
        # A user may only ever touch their own in-flight uploads.
        return self.model.objects.filter(user=request.user)

    def validate(self, request):
        problem = get_object_or_404(Problem, code=self.kwargs['problem'])
        if not problem.is_editable_by(request.user):
            raise ChunkedUploadError(status=http_status.HTTP_403_FORBIDDEN,
                                     detail=_('You cannot edit this problem.'))


@method_decorator(login_required, name='dispatch')
class ProblemDataChunkedUploadView(ProblemDataPermissionMixin, ChunkedUploadView):
    """Receives one ~10MB chunk per request and appends it to the upload on disk.

    State (offset, filename, status) is tracked in the ``chunked_upload`` table;
    the browser resumes from the returned ``offset`` if a chunk is retried.
    """
    field_name = 'file'


@method_decorator(login_required, name='dispatch')
class ProblemDataChunkedUploadCompleteView(ProblemDataPermissionMixin, ChunkedUploadCompleteView):
    """Finalises the upload and kicks off background reassembly into problem storage.

    md5 verification is intentionally disabled: hashing a multi-GB file in the
    browser is prohibitively slow, and the reassembly task re-opens the archive
    (``ZipFile``) which rejects any truncated or corrupt upload anyway.
    """
    do_md5_check = False

    def get_response_data(self, chunked_upload, request):
        # Hand the heavy disk copy + archive validation to Celery so the HTTP
        # request returns immediately (keeps us well under Cloudflare's 100s).
        task = reassemble_problem_data_zip.delay(chunked_upload.upload_id, self.kwargs['problem'])
        return {'task_id': task.id, 'upload_id': chunked_upload.upload_id}


class PolygonPermissionMixin:
    """Restrict Polygon package uploads to users who may import Polygon packages.

    The upload is not tied to a problem (import creates one; update re-checks
    editability when the form is submitted), so we only gate on the permission.
    """
    model = ChunkedUpload

    def get_queryset(self, request):
        return self.model.objects.filter(user=request.user)

    def validate(self, request):
        if not request.user.has_perm('judge.import_polygon_package'):
            raise ChunkedUploadError(status=http_status.HTTP_403_FORBIDDEN,
                                     detail=_('You cannot import Polygon packages.'))


@method_decorator(login_required, name='dispatch')
class PolygonChunkedUploadView(PolygonPermissionMixin, ChunkedUploadView):
    """Receives one ~10MB chunk per request for a Polygon package upload."""
    field_name = 'file'


@method_decorator(login_required, name='dispatch')
class PolygonChunkedUploadCompleteView(PolygonPermissionMixin, ChunkedUploadCompleteView):
    """Finalises the upload only. The import itself is started by the form
    submit (which carries the import config), via a Celery task."""
    do_md5_check = False

    def get_response_data(self, chunked_upload, request):
        return {'upload_id': chunked_upload.upload_id}
