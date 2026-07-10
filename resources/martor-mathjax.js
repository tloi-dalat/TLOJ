jQuery(function ($) {
    $(document).on('martor:preview', function (e, $content) {
        function update_math() {
            if (window.MathJax && window.MathJax.typesetPromise) {
                MathJax.typesetPromise([$content[0]]).then(function () {
                    $content.find('.tex-image').hide();
                    $content.find('.tex-text').show();
                });
            }
        }

        var $jax = $content.find('.require-mathjax-support');
        if ($jax.length) {
            if (!window.MathJax || !window.MathJax.typesetPromise) {
                if (window.MathJax && window.MathJax.startup && window.MathJax.startup.promise) {
                    window.MathJax.startup.promise.then(update_math);
                } else if (window.MathJax) {
                    var interval = setInterval(function () {
                        if (window.MathJax.typesetPromise) {
                            clearInterval(interval);
                            update_math();
                        } else if (window.MathJax.startup && window.MathJax.startup.promise) {
                            clearInterval(interval);
                            window.MathJax.startup.promise.then(update_math);
                        }
                    }, 50);
                } else {
                    $.ajax({
                        type: 'GET',
                        url: $jax.attr('data-config'),
                        dataType: 'script',
                        cache: true,
                        success: function () {
                            window.MathJax.startup = {
                                typeset: false,
                                ready: function () {
                                    MathJax.startup.defaultReady();
                                    MathJax.startup.promise.then(update_math);
                                }
                            };
                            $.ajax({
                                type: 'GET',
                                url: '/static/mathjax/4.1.2/tex-chtml.min.js',
                                dataType: 'script',
                                cache: true
                            });
                        }
                    });
                }
            } else {
                update_math();
            }
        }
    })
});
