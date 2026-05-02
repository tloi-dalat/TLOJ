(function () {
    let standings = [];
    const problemIndexMap = {};
    const problemMaxPoints = {};
    let currentIndex = 0;
    let currentAction = 0;
    let isStarting = false;
    let isRunning = false;
    let penaltyPerSubmission = 20;
    let currentScreen = 0;
    const moveDurationMs = 1200;
    const transitionStyle = `transform ${moveDurationMs / 1000}s cubic-bezier(0.4, 0, 0.2, 1), background-color 0.3s`;

    async function sha512Hash(string) {
        return crypto.subtle.digest("SHA-512", new TextEncoder("utf-8").encode(string)).then(buf => {
            return Array.prototype.map.call(new Uint8Array(buf), x => (('00' + x.toString(16)).slice(-2))).join('');
        });
    }

    function getColorForScore(score, maxScore) {
        if (score === 0) return '';
        score = Math.max(0, Math.min(maxScore, score));
        const startColor = { r: 167, g: 11, b: 11 }, midColor = { r: 167, g: 167, b: 11 }, endColor = { r: 11, g: 167, b: 11 };
        let r, g, b;
        const midPoint = maxScore / 2;
        if (score <= midPoint) {
            const ratio = score / midPoint;
            r = Math.round(startColor.r + (midColor.r - startColor.r) * ratio);
            g = Math.round(startColor.g + (midColor.g - startColor.g) * ratio);
            b = Math.round(startColor.b + (midColor.b - startColor.b) * ratio);
        } else {
            const ratio = (score - midPoint) / midPoint;
            r = Math.round(midColor.r + (endColor.r - midColor.r) * ratio);
            g = Math.round(midColor.g + (endColor.g - midColor.g) * ratio);
            b = Math.round(midColor.b + (endColor.b - midColor.b) * ratio);
        }
        const toHex = (c) => c.toString(16).padStart(2, '0');
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
    }

    function formatScoreAndTime(score, subBefore, subAfter, minutes) {
        return `${score} (${subBefore} + ${subAfter}, ${minutes})`;
    }

    function getTotalPenalty(minutes, subBefore) {
        return minutes + Math.max(subBefore - 1, 0) * penaltyPerSubmission;
    }

    function normalizeVerdict(verdict, points) {
        const raw = (verdict || "").toString().toUpperCase();
        const map = {
            OK: "AC",
            PARTIAL: "PARTIAL",
            WRONG_ANSWER: "WA",
            TIME_LIMIT_EXCEEDED: "TLE",
            MEMORY_LIMIT_EXCEEDED: "MLE",
            IDLENESS_LIMIT_EXCEEDED: "IR",
            PRESENTATION_ERROR: "PE",
            RUNTIME_ERROR: "RTE",
            COMPILE_ERROR: "CE",
            INTERNAL_ERROR: "IE"
        };
        if (map[raw]) return map[raw];
        if (raw) return raw;
        return points > 0 ? "AC" : "WA";
    }

    function getVerdictStyle(verdict, points, maxScore) {
        const code = normalizeVerdict(verdict, points);
        if (code === "AC") return { bg: "#53f23f", fg: "green" };
        if (code === "PARTIAL" || code === "_AC") return { bg: "#DFFF00", fg: "green" };
        if (code === "WA") return { bg: "#CCC", fg: "#ef1b53" };
        if (code === "TLE" || code === "MLE") return { bg: "#CCC", fg: "black" };
        if (code === "IR" || code === "RTE" || code === "OLE" || code === "OTH" || code === "PE") {
            return { bg: "#FAB623", fg: "black" };
        }
        if (code === "CE" || code === "AB") return { bg: "#CCC", fg: "black" };
        if (code === "IE") return { bg: "red", fg: "black" };
        return { bg: "#666", fg: "white" };
    }

    function renderPointBox(box, pD, useAfterFreeze = false) {
        const state = useAfterFreeze ? pD.afterFreeze : pD.beforeFreeze;
        const verdict = useAfterFreeze ? pD.afterFreezeVerdict : pD.beforeFreezeVerdict;
        if (!state) return;
        const style = getVerdictStyle(verdict, state[0], problemMaxPoints[pD.index]);
        box.textContent = formatScoreAndTime(state[0], state[2], state[3], state[1]);
        box.style.background = style.bg;
        box.style.color = style.fg;
    }

    function getRankClass(contestant) {
        if (!contestant.rank && !contestant.rankClass) return "rate-none";
        const rank = String(contestant.rankClass || contestant.rank);
        if (rank.startsWith("rate-")) return rank;
        return "rate-" + rank.toLowerCase().replace(/\s+/g, "-");
    }

    function getRanksForOrder(order) {
        const ranks = [];
        order.forEach((u, i) => {
            if (i > 0 && u.totalScore == order[i - 1].totalScore && u.totalTime == order[i - 1].totalTime) ranks.push(ranks[i - 1]);
            else ranks.push(i + 1);
        });
        return ranks;
    }

    function applyRanks(order) {
        const ranks = getRanksForOrder(order);
        order.forEach((u, i) => { u.rank = ranks[i]; });
    }

    function animateRankNumber(element, from, to) {
        const start = performance.now();
        const tick = now => {
            const progress = Math.min((now - start) / moveDurationMs, 1);
            element.textContent = Math.round(from + (to - from) * progress);
            if (progress < 1) requestAnimationFrame(tick);
            else element.textContent = to;
        };
        requestAnimationFrame(tick);
    }

    function centeredScrollTop(container, index, height) {
        const top = index * height - (container.clientHeight - height) / 2;
        return Math.max(0, Math.min(container.scrollHeight - container.clientHeight, top));
    }

    function centerRow(index, behavior = "smooth") {
        const container = document.getElementById("standings");
        const row = container && container.children[index];
        if (!container || !row) return;
        container.scrollTo({ top: centeredScrollTop(container, index, row.offsetHeight), behavior });
    }

    function easeMove(t) {
        return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animateScrollPosition(container, fromIndex, toIndex, height) {
        const from = container.scrollTop;
        const to = centeredScrollTop(container, toIndex, height);
        const start = performance.now();
        const tick = now => {
            const progress = Math.min((now - start) / moveDurationMs, 1);
            container.scrollTop = from + (to - from) * easeMove(progress);
            if (progress < 1) requestAnimationFrame(tick);
            else container.scrollTop = to;
        };
        container.scrollTop = centeredScrollTop(container, fromIndex, height);
        requestAnimationFrame(tick);
    }

    function animateRankChanges(boxes, order, fromIndex, toIndex) {
        const nextOrder = [...order];
        const movingUser = nextOrder.splice(fromIndex, 1)[0];
        nextOrder.splice(toIndex, 0, movingUser);
        const ranks = getRanksForOrder(nextOrder);
        const targetRanks = new Map(nextOrder.map((u, i) => [u, ranks[i]]));
        for (let i = toIndex; i <= fromIndex; i++) {
            animateRankNumber(boxes[i].querySelector(".rank"), order[i].rank, targetRanks.get(order[i]));
        }
        return { nextOrder, targetRank: targetRanks.get(movingUser) };
    }

    function clearResolverHighlights() {
        document.querySelectorAll(".rank-box").forEach(box => {
            box.classList.remove("active-user", "up", "down");
            box.style.zIndex = "";
            box.style.transform = "";
        });
        document.querySelectorAll(".point-box").forEach(box => box.classList.remove("active-problem", "revealing"));
    }

    function setActiveRow(row) {
        document.querySelectorAll(".rank-box.active-user").forEach(box => box.classList.remove("active-user"));
        if (row) row.classList.add("active-user");
    }

    window.changeOption = function() {
        const option = document.getElementById("option").value;
        document.getElementById("input-json").style.display = option === "json" ? "block" : "none";
        document.getElementById("input-cf").style.display = option === "cf" ? "block" : "none";
    };

    window.readJSON = function() {
        const file = document.getElementById("file").files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => { document.getElementById("json-data").value = e.target.result; };
        reader.readAsText(file);
    };

    async function fetchAPI(method, params, apiKey, apiSecret) {
        let url = `https://codeforces.com/api/${method}?` + (new URLSearchParams(params).toString());
        if (apiKey && apiSecret) {
            const time = Math.floor(Date.now() / 1000);
            const rand = Math.floor(Math.random() * 900000) + 100000;
            params.apiKey = apiKey; params.time = time;
            const sortedParams = Object.fromEntries(Object.entries(params).sort(([a], [b]) => a.localeCompare(b)));
            const hash = await sha512Hash(`${rand}/${method}?` + (new URLSearchParams(sortedParams).toString()) + '#' + apiSecret);
            url += `&apiKey=${apiKey}&time=${time}&apiSig=${rand}${hash}`;
        }
        const response = await fetch(url);
        return await response.json();
    }

    window.fetchContest = async function() {
        const contestId = document.getElementById("contestId").value.trim();
        const apiKey = document.getElementById("apiKey").value.trim();
        const apiSecret = document.getElementById("apiSecret").value.trim();
        if (!contestId) return;
        const jsonText = document.getElementById("json-data");
        jsonText.value = "Fetching data...";
        const standingsRes = await fetchAPI('contest.standings', { contestId, participantTypes: "CONTESTANT", asManager: !!apiKey }, apiKey, apiSecret);
        if (standingsRes.status !== "OK") { jsonText.value = standingsRes.comment; return; }
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetchAPI('contest.status', { contestId, asManager: !!apiKey }, apiKey, apiSecret);
        if (statusRes.status !== "OK") { jsonText.value = statusRes.comment; return; }
        let submissions = statusRes.result.filter(s => s.author.participantType === "CONTESTANT");
        const verdicts = ["OK", "PARTIAL", "RUNTIME_ERROR", "WRONG_ANSWER", "PRESENTATION_ERROR", "TIME_LIMIT_EXCEEDED", "MEMORY_LIMIT_EXCEEDED", "IDLENESS_LIMIT_EXCEEDED"];
        submissions = submissions.filter(s => verdicts.includes(s.verdict)).reverse();
        const { contest, problems } = standingsRes.result;
        const data = {
            contest: {
                name: contest.name,
                durationMinutes: Math.floor(contest.durationSeconds / 60),
                freezeDurationMinutes: Math.floor((contest.freezeDurationSeconds || 3600) / 60),
                penaltyMinutes: 20
            },
            problems: problems.map(p => ({ index: p.index, points: p.points || (contest.type === "IOI" ? 100 : 1) })),
            contestants: standingsRes.result.rows.map(row => ({ name: row.party.members[0].handle, logo: null, rank: null })),
            submissions: submissions.map(s => ({
                name: s.author.members[0].handle, problemIndex: s.problem.index,
                submitMinutes: Math.floor(s.relativeTimeSeconds / 60),
                points: s.points || (s.verdict === "OK" ? 1 : 0),
                verdict: s.verdict
            }))
        };
        jsonText.value = JSON.stringify(data, null, 2);
    };

    window.startContest = function() {
        const text = document.getElementById("json-data").value;
        try {
            const data = JSON.parse(text);
            document.getElementById("input-screen").classList.add("hidden");
            document.getElementById("splash-screen").classList.remove("hidden");
            currentScreen = 1;
            processContest(data);
        } catch (e) { alert("Invalid JSON"); }
    };

    function processContest(data) {
        const { contest, problems, contestants, submissions } = data;
        penaltyPerSubmission = contest.penaltyMinutes;
        problems.forEach((p, idx) => { problemIndexMap[p.index] = idx; problemMaxPoints[p.index] = p.points; });
        standings = contestants.map((c, idx) => {
            const uSubs = submissions.filter(s => s.name == c.name);
            const uProbs = problems.map(p => {
                const pSubs = uSubs.filter(s => s.problemIndex == p.index);
                const pD = {
                    index: p.index,
                    beforeFreeze: null,
                    afterFreeze: null,
                    beforeFreezeVerdict: null,
                    afterFreezeVerdict: null,
                    submitAfterFreeze: false
                };
                for (const s of pSubs) {
                    const verdict = normalizeVerdict(s.verdict, s.points);
                    if (s.submitMinutes < contest.durationMinutes - contest.freezeDurationMinutes) {
                        if (pD.beforeFreeze == null) {
                            if (s.points > 0) pD.beforeFreeze = [s.points, s.submitMinutes, 1, 0];
                            else pD.beforeFreeze = [0, 0, 0, 1];
                        } else {
                            if (s.points > pD.beforeFreeze[0]) {
                                pD.beforeFreeze[0] = s.points; pD.beforeFreeze[1] = s.submitMinutes;
                                pD.beforeFreeze[2] += pD.beforeFreeze[3] + 1; pD.beforeFreeze[3] = 0;
                            } else pD.beforeFreeze[3]++;
                        }
                        pD.beforeFreezeVerdict = verdict;
                        pD.afterFreeze = [...pD.beforeFreeze];
                        pD.afterFreezeVerdict = verdict;
                    } else {
                        if (pD.afterFreeze == null) {
                            if (s.points > 0) pD.afterFreeze = [s.points, s.submitMinutes, 1, 0];
                            else pD.afterFreeze = [0, 0, 0, 1];
                        } else {
                            if (s.points > pD.afterFreeze[0]) {
                                pD.afterFreeze[0] = s.points; pD.afterFreeze[1] = s.submitMinutes;
                                pD.afterFreeze[2] += pD.afterFreeze[3] + 1; pD.afterFreeze[3] = 0;
                            } else pD.afterFreeze[3]++;
                        }
                        pD.afterFreezeVerdict = verdict;
                    }
                }
                const beforeScore = pD.beforeFreeze ? pD.beforeFreeze[0] : 0;
                const afterScore = pD.afterFreeze ? pD.afterFreeze[0] : 0;
                pD.submitAfterFreeze = afterScore > beforeScore;
                return pD;
            });
            return {
                rank: 0, name: c.name, logo: c.logo, rankClass: getRankClass(c), problems: uProbs, originalIndex: idx,
                totalScore: uProbs.reduce((acc, p) => acc + (p.beforeFreeze ? p.beforeFreeze[0] : 0), 0),
                totalTime: uProbs.reduce((acc, p) => acc + (p.beforeFreeze ? getTotalPenalty(p.beforeFreeze[1], p.beforeFreeze[2]) : 0), 0)
            };
        });
        standings.sort((a, b) => (b.totalScore - a.totalScore) || (a.totalTime - b.totalTime) || (a.originalIndex - b.originalIndex));
        applyRanks(standings);
        const container = document.getElementById('standings'); container.innerHTML = "";
        standings.forEach(u => {
            const row = document.createElement('div'); row.className = 'rank-box';
            row.innerHTML = `<div class="rank">${u.rank}</div><div class="user-info"><img class="avatar" src="${u.logo || '/static/icons/default-user.png'}" onerror="this.src='/static/icons/default-user.png'"><div class="user-details"><div class="name ${u.rankClass}">${u.name}</div><div class="problem-points"></div></div></div><div class="total-score">${u.totalScore}</div><div class="total-time">${u.totalTime}</div>`;
            const ptsDiv = row.querySelector('.problem-points');
            u.problems.forEach(p => {
                const b = document.createElement('div'); b.className = 'point-box';
                if (p.submitAfterFreeze) {
                    b.textContent = p.beforeFreeze ? formatScoreAndTime(p.beforeFreeze[0], p.beforeFreeze[2], p.afterFreeze[2] + p.afterFreeze[3] - p.beforeFreeze[2], p.beforeFreeze[1]) : formatScoreAndTime(0, 0, p.afterFreeze[2] + p.afterFreeze[3], 0);
                    b.style.background = "gray";
                } else if (p.beforeFreeze) {
                    renderPointBox(b, p, false);
                } else b.textContent = p.index;
                ptsDiv.appendChild(b);
            });
            container.appendChild(row);
        });
        const pending = standings.reduce((acc, u) => acc + u.problems.filter(p => p.submitAfterFreeze).length, 0);
        document.getElementById('contest-name') && (document.getElementById('contest-name').textContent = contest.name);
        document.getElementById('splash-pending').textContent = `${pending} ${window.resolverConfig ? window.resolverConfig.labels.pendingSubmissions : "submissions pending"}`;
        document.getElementById('splash-instruction') && (document.getElementById('splash-instruction').textContent = window.resolverConfig ? window.resolverConfig.labels.pressEnter : "Press Enter to start");
        currentIndex = standings.length - 1; isStarting = true;
    }

    function run(auto = false) {
        return new Promise(resolve => {
            const allBoxes = Array.from(document.querySelectorAll(".rank-box"));
            if (currentIndex < 0) {
                clearResolverHighlights();
                resolve();
                return;
            }
            const currentBox = allBoxes[currentIndex];
            if (currentBox) centerRow(currentIndex, "smooth");
            if (currentAction == 0) {
                while (currentIndex >= 0 && !standings[currentIndex].problems.some(p => p.submitAfterFreeze)) { currentIndex--; }
                if (currentIndex < 0) {
                    clearResolverHighlights();
                    resolve();
                    return;
                }
                setActiveRow(allBoxes[currentIndex]);
                currentAction = 1; setTimeout(resolve, auto ? 300 : 0);
            } else if (currentAction == 1) {
                const unfrozenIdx = standings[currentIndex].problems.findIndex(p => p.submitAfterFreeze);
                currentBox.querySelectorAll('.point-box')[unfrozenIdx].classList.add('active-problem');
                currentAction = 2; setTimeout(resolve, auto ? 500 : 0);
            } else if (currentAction == 2) {
                const unfrozenIdx = standings[currentIndex].problems.findIndex(p => p.submitAfterFreeze);
                const pD = standings[currentIndex].problems[unfrozenIdx];
                const pBox = currentBox.querySelectorAll('.point-box')[unfrozenIdx];
                pBox.classList.add("revealing");
                pBox.style.background = "#2b2b2b";
                setTimeout(() => {
                    renderPointBox(pBox, pD, true);
                    pBox.classList.remove("revealing");
                    pBox.classList.remove('active-problem');
                    const oldS = pD.beforeFreeze ? pD.beforeFreeze[0] : 0, oldP = pD.beforeFreeze ? getTotalPenalty(pD.beforeFreeze[1], pD.beforeFreeze[2]) : 0;
                    standings[currentIndex].totalScore += pD.afterFreeze[0] - oldS;
                    standings[currentIndex].totalTime += getTotalPenalty(pD.afterFreeze[1], pD.afterFreeze[2]) - oldP;
                    currentBox.querySelector('.total-score').textContent = standings[currentIndex].totalScore;
                    currentBox.querySelector('.total-time').textContent = standings[currentIndex].totalTime;
                    pD.submitAfterFreeze = false;
                    let newIndex = currentIndex;
                    for (let i = currentIndex - 1; i >= 0; i--) {
                        const a = standings[currentIndex], b = standings[i];
                        if (a.totalScore > b.totalScore || (a.totalScore == b.totalScore && a.totalTime < b.totalTime) || (a.totalScore == b.totalScore && a.totalTime == b.totalTime && a.originalIndex < b.originalIndex)) newIndex = i;
                        else break;
                    }
                    if (newIndex !== currentIndex) {
                        const movingBox = currentBox, height = movingBox.offsetHeight, distance = currentIndex - newIndex;
                        setActiveRow(movingBox);
                        animateRankChanges(allBoxes, standings, currentIndex, newIndex);
                        const container = document.getElementById("standings");
                        animateScrollPosition(container, currentIndex, newIndex, height);
                        movingBox.classList.add("up"); movingBox.style.zIndex = "10"; movingBox.style.transform = `translateY(${-height * distance}px)`;
                        for (let i = newIndex; i < currentIndex; i++) allBoxes[i].style.transform = `translateY(${height}px)`;
                        setTimeout(() => {
                            const user = standings.splice(currentIndex, 1)[0]; standings.splice(newIndex, 0, user);
                            container.insertBefore(movingBox, container.children[newIndex]);
                            Array.from(document.querySelectorAll(".rank-box")).forEach(b => { b.style.transition = "none"; b.style.transform = ""; b.style.zIndex = ""; });
                            container.offsetHeight; Array.from(document.querySelectorAll(".rank-box")).forEach(b => { b.style.transition = transitionStyle; });
                            setTimeout(() => { movingBox.classList.remove("up"); }, 300);
                            applyRanks(standings);
                            for (let i = 0; i < standings.length; i++) {
                                const rb = Array.from(document.querySelectorAll(".rank-box")).find(b => b.querySelector(".name").textContent == standings[i].name);
                                rb.querySelector(".rank").textContent = standings[i].rank;
                            }
                            centerRow(newIndex, "auto");
                            currentAction = standings[currentIndex] && standings[currentIndex].problems.some(p => p.submitAfterFreeze) ? 1 : 0;
                            resolve();
                        }, moveDurationMs);
                    } else {
                        currentAction = standings[currentIndex].problems.some(p => p.submitAfterFreeze) ? 1 : 0;
                        setTimeout(resolve, auto ? 300 : 0);
                    }
                }, 500);
            }
        });
    }

    document.addEventListener("keydown", async function (e) {
        const key = e.key.toLowerCase();
        const splash = document.getElementById('splash-screen');
        const output = document.getElementById('output-screen');
        if (key === 'enter' && splash && !splash.classList.contains('hidden')) {
            if (window.resolverConfig || currentScreen === 1) {
                splash.classList.add('hidden'); output.classList.remove('hidden');
                currentScreen = 2; return;
            }
        }
        if (!isStarting || isRunning || (currentScreen !== 2 && !window.resolverConfig)) return;
        if (key === 'n') { isRunning = true; await run(); isRunning = false; }
        else if (key === 'a') { isRunning = true; while (currentIndex >= 0 || currentAction != 0) await run(true); isRunning = false; }
        else if (key === 'r') location.reload();
    });

    window.processContest = processContest;

    document.addEventListener('DOMContentLoaded', () => {
        if (window.resolverConfig) {
            if (window.resolverConfig.dataUrl) {
                fetch(window.resolverConfig.dataUrl, { credentials: 'same-origin' }).then(r => r.json()).then(processContest);
            } else if (window.resolverConfig.loadFromSession) {
                const data = sessionStorage.getItem('resolver_data');
                if (data) processContest(JSON.parse(data));
            }
        }
    });
})();
