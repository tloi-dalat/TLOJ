(function () {
    'use strict';

    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    ready(function () {
        var cfg = window.chunkedUploadConfig;
        if (!cfg) return;

        var fileInput = document.querySelector('[data-chunked-upload]');
        if (!fileInput) return;

        var form = fileInput.closest('form');
        var status = document.getElementById('chunked-upload-status');

        var overlay = document.createElement('div');
        overlay.id = 'chunked-upload-overlay';
        overlay.style.display = 'none';
        overlay.innerHTML =
            '<div class="chunked-upload-modal">' +
                '<div class="chunked-upload-modal-title"></div>' +
                '<progress class="chunked-upload-modal-bar" max="100"></progress>' +
            '</div>';
        document.body.appendChild(overlay);
        var ovTitle = overlay.querySelector('.chunked-upload-modal-title');
        var ovBar = overlay.querySelector('.chunked-upload-modal-bar');

        function showStage(title, pct) {
            overlay.style.display = 'flex';
            ovTitle.textContent = title;
            if (typeof pct === 'number') {
                ovBar.value = pct;
            } else {
                ovBar.removeAttribute('value');
            }
        }

        function hideOverlay() {
            overlay.style.display = 'none';
        }

        function setError(message) {
            status.textContent = message || '';
            status.classList.toggle('chunked-upload-error', !!message);
        }

        function lockSubmit(locked) {
            form.querySelectorAll('button[type=submit], input[type=submit]')
                .forEach(function (b) { b.disabled = locked; });
        }

        function resubmit() {
            if (form.requestSubmit) form.requestSubmit();
            else form.submit();
        }

        var uploaded = false;
        fileInput.addEventListener('change', function () {
            uploaded = false;
            setError('');
        });

        form.addEventListener('submit', function (e) {
            var file = fileInput.files[0];
            if (!file || uploaded) return;

            e.preventDefault();
            e.stopImmediatePropagation();

            if (cfg.maxBytes && file.size > cfg.maxBytes) {
                setError(cfg.i18n.tooLarge + ' (' + Math.floor(cfg.maxBytes / 1048576) + ' MB)');
                return;
            }

            lockSubmit(true);
            setError('');

            uploadFile(file).then(function () {
                uploaded = true;
                showStage(cfg.i18n.done, 100);
                resubmit();
            }).catch(function (err) {
                hideOverlay();
                lockSubmit(false);
                setError(cfg.i18n.failed + ' ' + err.message);
            });
        }, true);

        function postForm(url, formData, headers) {
            var allHeaders = Object.assign({'X-CSRFToken': cfg.csrfToken}, headers || {});
            return fetch(url, {
                method: 'POST',
                headers: allHeaders,
                body: formData,
                credentials: 'same-origin',
            }).then(function (response) {
                return response.json().catch(function () { return {}; }).then(function (data) {
                    if (!response.ok) {
                        throw new Error(data.detail || data.error || ('HTTP ' + response.status));
                    }
                    return data;
                });
            });
        }

        function uploadFile(file) {
            showStage(cfg.i18n.uploading, 0);

            var total = file.size;
            var uploadId = null;

            function sendChunk(start) {
                if (start >= total) return complete(uploadId);

                var end = Math.min(start + cfg.chunkSize, total);
                var fd = new FormData();
                fd.append('file', file.slice(start, end), file.name);
                if (uploadId) fd.append('upload_id', uploadId);

                var range = 'bytes ' + start + '-' + (end - 1) + '/' + total;

                return postForm(cfg.uploadUrl, fd, {'Content-Range': range}).then(function (data) {
                    uploadId = data.upload_id || uploadId;
                    var next = typeof data.offset === 'number' ? data.offset : end;
                    showStage(cfg.i18n.uploading, next / total * 100);
                    return sendChunk(next);
                });
            }

            return sendChunk(0);
        }

        function complete(uploadId) {
            showStage(cfg.i18n.processing, null);
            var fd = new FormData();
            fd.append('upload_id', uploadId);
            return postForm(cfg.completeUrl, fd).then(function (data) {
                var hidden = form.querySelector('[data-chunked-upload-id]');
                if (hidden) hidden.value = data.upload_id;
                if (data.task_id) {
                    return pollTask(data.task_id);
                }
            });
        }

        function pollTask(taskId) {
            return new Promise(function (resolve, reject) {
                (function check() {
                    fetch(cfg.statusUrl + '?id=' + encodeURIComponent(taskId), {credentials: 'same-origin'})
                        .then(function (r) { return r.json(); })
                        .then(function (data) {
                            if (data.code === 'SUCCESS') {
                                resolve();
                            } else if (data.code === 'FAILURE') {
                                reject(new Error(data.error || ''));
                            } else {
                                setTimeout(check, 1500);
                            }
                        })
                        .catch(function () { setTimeout(check, 3000); });
                })();
            });
        }
    });
})();
