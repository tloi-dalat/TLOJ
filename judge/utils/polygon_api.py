import hashlib
import random
import string
import time

import requests

__all__ = ['PolygonApiError', 'PolygonClient']


class PolygonApiError(Exception):
    pass


class PolygonClient:
    def __init__(self, base_url, api_key, api_secret):
        if not api_key or not api_secret:
            raise PolygonApiError('Polygon API credentials are not configured.')
        self.base_url = base_url.rstrip('/')
        self.api_key = api_key
        self.api_secret = api_secret

    def _signed_params(self, method, params):
        params = {k: str(v) for k, v in params.items() if v is not None}
        params['apiKey'] = self.api_key
        params['time'] = str(int(time.time()))

        rand = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
        items = sorted(params.items())
        query = '&'.join(f'{k}={v}' for k, v in items)
        to_hash = f'{rand}/{method}?{query}#{self.api_secret}'
        params['apiSig'] = rand + hashlib.sha512(to_hash.encode('utf-8')).hexdigest()
        return params

    def _request(self, method, params, stream=False):
        url = f'{self.base_url}/{method}'
        try:
            response = requests.post(url, data=self._signed_params(method, params), stream=stream, timeout=120)
        except requests.RequestException as e:
            raise PolygonApiError(f'Failed to reach Polygon API: {e}')
        return response

    def _call_json(self, method, params):
        response = self._request(method, params)
        try:
            data = response.json()
        except ValueError:
            raise PolygonApiError(f'Polygon API returned a non-JSON response ({response.status_code}).')
        if data.get('status') != 'OK':
            raise PolygonApiError(data.get('comment') or 'Polygon API request failed.')
        return data.get('result')

    def list_packages(self, problem_id):
        return self._call_json('problem.packages', {'problemId': problem_id})

    def latest_ready_package_id(self, problem_id):
        packages = self.list_packages(problem_id) or []
        ready = [p for p in packages if p.get('state') == 'READY']
        if not ready:
            raise PolygonApiError(
                'No READY package found for this problem. '
                'Build a package in Polygon and make sure it has finished.',
            )
        return max(ready, key=lambda p: p.get('creationTimeSeconds', 0))['id']

    def download_package(self, problem_id, package_id, dest_path, package_type='linux'):
        """Download a package zip to dest_path. ``linux`` packages contain generated tests."""
        response = self._request('problem.package', {
            'problemId': problem_id,
            'packageId': package_id,
            'type': package_type,
        }, stream=True)

        content_type = response.headers.get('Content-Type', '')
        if 'application/json' in content_type:
            try:
                comment = response.json().get('comment')
            except ValueError:
                comment = None
            raise PolygonApiError(comment or 'Failed to download package from Polygon.')
        if response.status_code != 200:
            raise PolygonApiError(f'Failed to download package from Polygon (HTTP {response.status_code}).')

        with open(dest_path, 'wb') as f:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)
        return dest_path
