# Third-party references

`chaoxing_read.py` adapts the login, course-link discovery and homework-page protocol from
[DanMo661/xuexitong-cli](https://github.com/DanMo661/xuexitong-cli), commit
`74b843ad4a3439a6ee5ba33f6a3288d9be6ed990`.
OHU replaces persistent cookies/password files with one-request in-memory sessions,
restricts outbound hosts, bounds response sizes and reports partial query failures.

MIT License

Copyright (c) 2026 Wu Jiale

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

`physical_read.py` is independently written against HTML form/table semantics. Its
school origin and three student page paths were identified as public URL literals
in the publicly distributed Jianghaidai v0.8.1 APK. No Jianghaidai implementation,
assets, private service endpoints or credentials were copied. The release repository
states that its application source is private and has no open-source license.
