# TLOJ: TLOI Online Judge  
[![AGPL License](https://img.shields.io/badge/license-AGPLv3.0-blue.svg)](http://www.gnu.org/licenses/agpl-3.0)

As a fork of [DMOJ](https://github.com/DMOJ/online-judge) and [VNOJ (VNOI Online Judge)](https://github.com/VNOI-Admin/OJ),  
TLOJ serves as TLOI's online judge and hosts its programming contests.

See it live at https://oj.tloi.io.vn

GitHub repository: https://github.com/tloi-dalat/TLOJ 

## Features

Check out its features [here](https://github.com/DMOJ/online-judge#features).

## Installation

Refer to the install documentation [here](https://vnoi-admin.github.io/vnoj-docs/#/site/installation). Almost all installation steps remain the same as the docs, but there are several minor differences, including cloning this repo instead of DMOJ's repo.

### Additional installation steps

- You **have to** define `DMOJ_PROBLEM_DATA_ROOT` in `local_settings.py`, which should be the path to the directory that contains your problems' tests.

- Regarding disabling full-text search, please read [this issue](https://github.com/VNOI-Admin/OJ/issues/4) for more information.

- To sync the judge server and the site's cache, change the cache framework (`CACHES`) to `memcached` or `redis` instead of the default (local-memory caching).

- If you use `python3 manage.py loaddata demo`, the home button in the admin dashboard (/admin) links you to `localhost:8081`, there are 2 ways to change that:

  1. You can change that in [demo.json](/judge/fixtures/demo.json)
  2. You can go to the admin page, scroll down to find the `Sites` setting and change `localhost:8081` to your domain.

- To support `testlib.h`, you need to copy [testlib.h](https://github.com/MikeMirzayanov/testlib/blob/master/testlib.h) to `g++`'s include path in the judge server. To speed up compile time, you can also create a precompiled header for `testlib.h`.

## Contributing ![PR's Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat)

Take a look at [our contribution guideline](contributing.md).

If you find any bug, please feel free to open an issue on GitHub.

Pull requests are welcome as well. Before you submit your PR, please check your code with [flake8](https://flake8.pycqa.org/en/latest/) and format it if needed. There's also `prettier` if you need to format JS code (in `websocket/`).

Translation contributions are also welcome.
