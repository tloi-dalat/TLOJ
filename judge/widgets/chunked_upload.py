from django.forms import ClearableFileInput
from django.utils.html import format_html
from django.utils.translation import gettext_lazy as _

__all__ = ('ChunkedFileUploadWidget',)


class ChunkedFileUploadWidget(ClearableFileInput):
    class Media:
        css = {'all': ('chunked_upload.css',)}
        js = ('chunked_upload.js',)

    def render(self, name, value, attrs=None, renderer=None):
        attrs = attrs or {}
        input_id = attrs.get('id', 'id_%s' % name)

        current = ''
        if value and getattr(value, 'name', None):
            current = format_html(
                '<div class="chunked-upload-current">{label} <code>{filename}</code>'
                '<label class="chunked-upload-clear">'
                '<input type="checkbox" name="{clear_name}" id="{clear_id}"> {clear_label}</label></div>',
                label=_('Currently:'),
                filename=value.name,
                clear_name='%s-clear' % name,
                clear_id='%s-clear_id' % name,
                clear_label=_('Clear'),
            )

        return format_html(
            '{current}'
            '<input type="file" id="{input_id}" accept=".zip" data-chunked-upload>'
            '<div class="chunked-upload-status" id="chunked-upload-status"></div>',
            current=current,
            input_id=input_id,
        )
