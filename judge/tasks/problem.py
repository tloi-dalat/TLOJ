import os
import shutil
import tempfile
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
           'import_polygon_package', 'import_polygon_package_from_api')

DEFAULT_POLYGON_TO_SITE_LANGUAGE_MAP = {'english': 'en', 'vietnamese': 'vi'}


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
    from chunked_upload.models import ChunkedUpload

    chunked_upload = ChunkedUpload.objects.get(upload_id=upload_id)
    problem = Problem.objects.get(code=problem_code)
    data = ProblemData.objects.get_or_create(problem=problem)[0]

    name = _problem_directory_file(problem.code, chunked_upload.filename)
    with chunked_upload.get_uploaded_file() as uploaded_file:
        saved_name = problem_data_storage.save(name, uploaded_file)

    try:
        with problem_data_storage.open(saved_name, 'rb') as f:
            zipfile.ZipFile(f).namelist()
    except zipfile.BadZipfile:
        problem_data_storage.delete(saved_name)
        chunked_upload.delete()
        raise ProblemDataError(_('The uploaded file is not a valid zip archive.'))

    data.zipfile.name = saved_name
    data.save()

    chunked_upload.delete()
    return {'zipfile': saved_name}


@shared_task
def import_polygon_package(upload_id, code, profile_id, do_update, config):
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


def _build_auto_language_config(package_path, base_config):
    from lxml import etree as ET

    site_codes = {code for code, _ in settings.LANGUAGES}
    with zipfile.ZipFile(package_path, 'r') as package:
        if 'problem.xml' not in package.namelist():
            raise ProblemDataError(_('problem.xml not found in the downloaded package.'))
        root = ET.fromstring(package.read('problem.xml'))

    languages = [statement.get('language', 'unknown')
                 for statement in root.findall('.//statement[@type="application/x-tex"]')]

    config = dict(base_config)
    config['main_statement_language'] = None
    config['polygon_to_site_language_map'] = {}

    if len(languages) > 1:
        for language in languages:
            site_language = DEFAULT_POLYGON_TO_SITE_LANGUAGE_MAP.get(language)
            if site_language is None and language in site_codes:
                site_language = language
            if site_language is None:
                raise ProblemDataError(
                    _('Cannot automatically map Polygon language "%s" to a site language. '
                      'Please upload the package manually to choose mappings.') % language,
                )
            if site_language == settings.LANGUAGE_CODE:
                config['main_statement_language'] = language
            else:
                config['polygon_to_site_language_map'][language] = site_language

        if config['main_statement_language'] is None:
            raise ProblemDataError(
                _('None of the package statements map to the main site language (%s).') % settings.LANGUAGE_CODE,
            )
        config['main_tutorial_language'] = config['main_statement_language']

    return config


@shared_task
def import_polygon_package_from_api(problem_id, code, profile_id, do_update, config):
    from judge.models import Profile
    from judge.utils.codeforces_polygon import PolygonImporter
    from judge.utils.polygon_api import PolygonApiError, PolygonClient

    profile = Profile.objects.get(id=profile_id)

    try:
        client = PolygonClient(
            settings.VNOJ_POLYGON_API_URL,
            settings.VNOJ_POLYGON_API_KEY,
            settings.VNOJ_POLYGON_API_SECRET,
        )
    except PolygonApiError as e:
        raise ProblemDataError(str(e))

    tmp_dir = tempfile.mkdtemp(prefix='polygon-')
    package_path = os.path.join(tmp_dir, 'package.zip')
    try:
        try:
            package_id = client.latest_ready_package_id(problem_id)
            client.download_package(problem_id, package_id, package_path)
        except PolygonApiError as e:
            raise ProblemDataError(str(e))

        config = _build_auto_language_config(package_path, config)

        importer = PolygonImporter(
            package=package_path,
            code=code,
            authors=[profile],
            curators=[],
            do_update=do_update,
            interactive=False,
            config=config,
        )
        importer.run()
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@shared_task
def delete_expired_chunked_uploads():
    from chunked_upload.models import ChunkedUpload
    from chunked_upload.settings import EXPIRATION_DELTA, UPLOAD_PATH

    cutoff = timezone.now() - EXPIRATION_DELTA
    for upload in ChunkedUpload.objects.filter(created_on__lte=cutoff):
        upload.delete()

    prefix = UPLOAD_PATH.split('%', 1)[0].strip('/\\')
    base_dir = os.path.join(ChunkedUpload._meta.get_field('file').storage.location, prefix)
    if os.path.isdir(base_dir):
        for root, dirs, files in os.walk(base_dir, topdown=False):
            if os.path.abspath(root) == os.path.abspath(base_dir):
                continue
            try:
                os.rmdir(root)
            except OSError:
                pass
