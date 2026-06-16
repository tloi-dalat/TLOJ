window.MathJax = {
    loader: {
        load: ['[tex]/color'],
        paths: {
            mathjax: '/static/mathjax/4.1.2'
        }
    },
    tex: {
        packages: {
            '[+]': ['color']
        },
        inlineMath: [
            ['~', '~'],
            ['\\(', '\\)']
        ]
    },
    chtml: {
        fontURL: '/static/mathjax/4.1.2/output/chtml/fonts/mathjax-newcm/chtml/woff2'
    },
    options: {
        enableMenu: false
    }
};
