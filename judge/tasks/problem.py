import os
import zipfile

from celery import shared_task
from django.conf import settings
from django.utils import timezone
from django.utils.translation import gettext as _

from judge.models import Problem, ProblemData, problem_data_storage
from judge.models.problem_data import _problem_directory_file
from judge.utils.problem_data import ProblemDataError
from judge.utils.problems import fast_delete_problem

__all__ = ('problem_garbage_collect', 'reassemble_problem_data_zip', 'delete_expired_chunked_uploads',
           'import_polygon_package')


@shared_task
def problem_garbage_collect():
    problems = Problem.expired_deletion.all()
    end = timezone.now() + settings.VNOJ_PROBLEM_GARBAGE_COLLECTOR_TIME_LIMIT
    for problem in problems:
        if timezone.now() > end:
            break
        fast_delete_problem(problem)


@shared_task
def reassemble_problem_data_zip(upload_id, problem_code):
    """Move a finished chunked upload into the problem's data directory.

    The chunks were reassembled into a single file under MEDIA_ROOT by
    django-chunked-upload. Here we copy that file into ``problem_data_storage``
    as ``<code>/<filename>`` and point ``ProblemData.zipfile`` at it, exactly as
    a normal form upload would. The package stays zipped — the judges read the
    archive directly via init.yml; we only validate that it opens as a zip.
    """
    from chunked_upload.models import ChunkedUpload

    chunked_upload = ChunkedUpload.objects.get(upload_id=upload_id)
    problem = Problem.objects.get(code=problem_code)
    data = ProblemData.objects.get_or_create(problem=problem)[0]

    name = _problem_directory_file(problem.code, chunked_upload.filename)
    with chunked_upload.get_uploaded_file() as uploaded_file:
        saved_name = problem_data_storage.save(name, uploaded_file)

    try:
        with problem_data_storage.open(saved_name, 'rb') as f:
            # Reading the central directory validates the archive structure
            # without decompressing every entry (cheap even for huge packages).
            zipfile.ZipFile(f).namelist()
    except zipfile.BadZipfile:
        problem_data_storage.delete(saved_name)
        chunked_upload.delete()
        raise ProblemDataError(_('The uploaded file is not a valid zip archive.'))

    data.zipfile.name = saved_name
    data.save()  # also refreshes zipfile_size

    # Drop the temporary chunked-upload file and DB row.
    chunked_upload.delete()
    return {'zipfile': saved_name}


@shared_task
def import_polygon_package(upload_id, code, profile_id, do_update, config):
    """Import a Codeforces Polygon package that was uploaded in chunks.

    Runs the (potentially slow) PolygonImporter in the background so a large
    package does not time out the HTTP request. The staged upload is removed
    afterwards regardless of outcome.
    """
    from chunked_upload.models import ChunkedUpload
    from judge.models import Profile
    from judge.utils.codeforces_polygon import PolygonImporter

    chunked_upload = ChunkedUpload.objects.get(upload_id=upload_id)
    profile = Profile.objects.get(id=profile_id)
    try:
        importer = PolygonImporter(
            package=chunked_upload.file.path,
            code=code,
            authors=[profile],
            curators=[],
            do_update=do_update,
            interactive=False,
            config=config,
        )
        importer.run()
    finally:
        chunked_upload.delete()


@shared_task
def delete_expired_chunked_uploads():
    """Prune abandoned chunked uploads (started but never completed).

    A completed upload is removed by reassemble_problem_data_zip, but an upload
    the user abandons mid-way lingers as a ``.part`` file under
    CHUNKED_UPLOAD_PATH. Once it is older than CHUNKED_UPLOAD_EXPIRATION_DELTA we
    delete the row and its file, then prune the empty date directories left
    behind (the library deletes files, not directories).
    """
    from chunked_upload.models import ChunkedUpload
    from chunked_upload.settings import EXPIRATION_DELTA, UPLOAD_PATH

    cutoff = timezone.now() - EXPIRATION_DELTA
    for upload in ChunkedUpload.objects.filter(created_on__lte=cutoff):
        upload.delete()  # removes both the DB row and the .part file

    # Prune the now-empty YYYY/MM/DD directories under the upload root, keeping
    # the root itself. The static prefix is the part of the upload path before
    # the first strftime token (e.g. 'chunked_uploads').
    prefix = UPLOAD_PATH.split('%', 1)[0].strip('/\\')
    base_dir = os.path.join(ChunkedUpload._meta.get_field('file').storage.location, prefix)
    if os.path.isdir(base_dir):
        for root, dirs, files in os.walk(base_dir, topdown=False):
            if os.path.abspath(root) == os.path.abspath(base_dir):
                continue
            try:
                os.rmdir(root)  # only removes the directory if it is empty
            except OSError:
                pass
