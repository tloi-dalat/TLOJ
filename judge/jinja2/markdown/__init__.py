import base64
import html as _html_module
import json as _json_module
import logging
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import markdown2
from bleach.css_sanitizer import CSSSanitizer
from bleach.sanitizer import Cleaner
from django.conf import settings
from lxml import html
from lxml.etree import ParserError, XMLSyntaxError
from markupsafe import Markup

from judge.highlight_code import highlight_code
from judge.jinja2.markdown.lazy_load import lazy_load as lazy_load_processor
from judge.utils.camo import client as camo_client
from judge.utils.texoid import TEXOID_ENABLED, TexoidRenderer
from .bleach_whitelist import all_styles, mathml_attrs, mathml_tags
from .. import registry

logger = logging.getLogger('judge.html')

_GRAPH_FENCE_RE = re.compile(
    r'(`{3,})[ \t]*graph((?:[ \t]+\w+)*)[ \t]*\n(.*?)\n\1[ \t]*(?:\n|$)',
    re.DOTALL,
)
_GRAPH_BLOCK_RE = re.compile(
    r'<pre><code class="language-graph((?:-\w+)*)">(.*?)</code></pre>',
    re.DOTALL,
)


def _preprocess_graph_fences(text):
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    def replace_fence(m):
        flags = m.group(2).strip()
        suffix = ('-' + '-'.join(flags.split())) if flags else ''
        return '\n<pre><code class="language-graph{}">{}</code></pre>\n'.format(
            suffix, _html_module.escape(m.group(3))
        )
    return _GRAPH_FENCE_RE.sub(replace_fence, text)


def _postprocess_graph_blocks(html_str):
    counter = [0]

    def replace_block(m):
        flags_suffix = m.group(1)
        flags = set(flags_suffix.strip('-').split('-')) if flags_suffix else set()
        flags.discard('')

        raw_content = _html_module.unescape(m.group(2))

        payload = _json_module.dumps({
            'edges': raw_content,
            'directed': 'directed' in flags,
            'weighted': 'weighted' in flags,
        })

        attr_val = base64.b64encode(payload.encode('utf-8')).decode('ascii')

        idx = counter[0]
        counter[0] += 1

        return (
            '<div class="graph-viewer-wrap" id="graph-viewer-{}">'
            '<canvas class="graph-viewer-canvas" data-graph-b64="{}"></canvas>'
            '</div>'
        ).format(idx, attr_val)

    return _GRAPH_BLOCK_RE.sub(replace_block, html_str)

NOFOLLOW_WHITELIST = settings.NOFOLLOW_EXCLUDED


cleaner_cache = {}


def get_cleaner(name, params):
    if name in cleaner_cache:
        return cleaner_cache[name]

    styles = params.pop('styles', None)
    if styles:
        params['css_sanitizer'] = CSSSanitizer(allowed_css_properties=all_styles if styles is True else styles)

    if params.pop('mathml', False):
        params['tags'] = params.get('tags', []) + mathml_tags
        params['attributes'] = params.get('attributes', {}).copy()
        params['attributes'].update(mathml_attrs)

    cleaner = cleaner_cache[name] = Cleaner(**params)
    return cleaner


def fragments_to_tree(fragment):
    tree = html.Element('div')
    try:
        parsed = html.fragments_fromstring(fragment, parser=html.HTMLParser(recover=True))
    except (XMLSyntaxError, ParserError) as e:
        if fragment and (not isinstance(e, ParserError) or e.args[0] != 'Document is empty'):
            logger.exception('Failed to parse HTML string')
        return tree

    if parsed and isinstance(parsed[0], str):
        tree.text = parsed[0]
        parsed = parsed[1:]
    tree.extend(parsed)
    return tree


def strip_paragraphs_tags(tree):
    for p in tree.xpath('.//p'):
        for child in p.iterchildren(reversed=True):
            p.addnext(child)
        parent = p.getparent()
        prev = p.getprevious()
        if prev is not None:
            prev.tail = (prev.tail or '') + p.text
        else:
            parent.text = (parent.text or '') + p.text
        parent.remove(p)


def fragment_tree_to_str(tree):
    return html.tostring(tree, encoding='unicode')[len('<div>'):-len('</div>')]


def inc_header(text, level):
    pattern = re.compile(
        r'<(\/?)h([1-9][0-9]*)>',
        re.X | re.M,
    )
    return re.sub(pattern, lambda x: '<' + x.group(1) + 'h' + str(int(x.group(2)) + level) + '>', text)


def add_table_class(text):
    return re.sub(r'<table(?=[\s>])', r'<table class="table"', text)


@registry.filter
def markdown(text, style, math_engine=None, lazy_load=False, strip_paragraphs=False):
    styles = settings.MARKDOWN_STYLES.get(style, settings.MARKDOWN_DEFAULT_STYLE)
    if styles.get('safe_mode', True):
        safe_mode = 'escape'
    else:
        safe_mode = None

    if safe_mode is None:
        text = _preprocess_graph_fences(text)

    extras = ['latex', 'spoiler', 'fenced-code-blocks', 'cuddled-lists', 'tables', 'strike']
    if styles.get('nofollow', True):
        extras.append('nofollow')

    bleach_params = styles.get('bleach', {})

    post_processors = []
    if styles.get('use_camo', False) and camo_client is not None:
        post_processors.append(camo_client.update_tree)
    if lazy_load:
        post_processors.append(lazy_load_processor)

    result = markdown2.markdown(text, safe_mode=safe_mode, extras=extras)

    result = add_table_class(result)
    result = inc_header(result, 2)

    if post_processors or strip_paragraphs:
        tree = fragments_to_tree(result)
        for processor in post_processors:
            processor(tree)
        if strip_paragraphs:
            strip_paragraphs_tags(tree)
        result = fragment_tree_to_str(tree)
    if bleach_params:
        result = get_cleaner(style, bleach_params).clean(result)
    if safe_mode is None:
        result = _postprocess_graph_blocks(result)
    return Markup(result)
