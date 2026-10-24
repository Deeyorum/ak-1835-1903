// Kindi sayfası simülasyonu — izleme ve oynama modları.
// Kararlar: docs/WEB-TASARIM.md. Veri: sim-data.js. Ağ çağrısı,
// depolama, sır YOK — tamamı bellekte, istemci tarafı.

(function () {
  "use strict";

  var DATA = window.AK_SIM_DATA;
  if (!DATA) return;

  function buildAdjacency(edges) {
    var adj = {};
    for (var i = 0; i < edges.length; i++) {
      var a = edges[i][0];
      var b = edges[i][1];
      if (!adj[a]) adj[a] = [];
      if (!adj[b]) adj[b] = [];
      adj[a].push(b);
      adj[b].push(a);
    }
    return adj;
  }

  function bfsDistances(adj, start) {
    var dist = {};
    dist[start] = 0;
    var queue = [start];
    while (queue.length) {
      var cur = queue.shift();
      var neighbors = adj[cur] || [];
      for (var i = 0; i < neighbors.length; i++) {
        var next = neighbors[i];
        if (dist[next] === undefined) {
          dist[next] = dist[cur] + 1;
          queue.push(next);
        }
      }
    }
    return dist;
  }

  // SPEC §6 bant eşikleri: yakın ≤2 / orta 3-4 / uzak ≥5.
  function bandFor(distance) {
    if (distance <= 2) return "near";
    if (distance <= 4) return "mid";
    return "far";
  }

  var adjacency = buildAdjacency(DATA.EDGES);
  var distances = bfsDistances(adjacency, DATA.HUNTER_START);

  function nodeById(id) {
    for (var i = 0; i < DATA.NODES.length; i++) {
      if (DATA.NODES[i].id === id) return DATA.NODES[i];
    }
    return undefined;
  }

  function refereeById(id) {
    for (var i = 0; i < DATA.REFEREES.length; i++) {
      if (DATA.REFEREES[i].id === id) return DATA.REFEREES[i];
    }
    return undefined;
  }

  function sliceValue(node, dilimTuru) {
    if (dilimTuru === "kategori") return node.category;
    if (dilimTuru === "harf") return node.title.charAt(0).toUpperCase();
    if (dilimTuru === "bolge") return bandFor(distances[node.id]);
    return undefined;
  }

  // Gizli yer artık burada SABİT değil — her Watch/Play oturumu
  // (sayfa yüklenince ve her Reset'te) kendi rastgele seçtiği
  // düğümü `watchState.secretNode`/`playState.secretNode` olarak
  // taşır. Oyun bitene kadar bu değer hiçbir DOM özniteliğine ya da
  // ekran metnine YAZILMAZ — yalnız JS durumunda tutulur.
  function pickRandomSecret() {
    return DATA.NODES[Math.floor(Math.random() * DATA.NODES.length)];
  }

  // Her koşulda gizli yerin kendi dilim değerine eşit olanlar kalır —
  // bu yüzden gizli yer hiçbir turda elenemez (kendi değerine her
  // zaman eşittir).
  function askReferee(hakemId, candidates, secretNode) {
    var ref = refereeById(hakemId);
    var value = sliceValue(secretNode, ref.dilimTuru);
    var narrowed = [];
    for (var i = 0; i < candidates.length; i++) {
      if (sliceValue(candidates[i], ref.dilimTuru) === value) {
        narrowed.push(candidates[i]);
      }
    }
    return { referee: ref, value: value, candidates: narrowed };
  }

  // 2-3 cümle: hakemin ne bildiği, bu turun cevabı, kaç aday elendi.
  // Gizli yerin adını hiçbir zaman söylemez. Eleme 0 ise (aday sayısı
  // değişmedi) "from N to N" demek yerine bunu açıkça söyler.
  function buildAnswerText(ref, value, beforeCount, afterCount) {
    var valueText = ref.valuePhrase.replace("{value}", value);
    var narrowingText = beforeCount === afterCount
      ? "That does not narrow anything: " + afterCount + " candidates remain."
      : "That narrows the candidates from " + beforeCount + " to " + afterCount + ".";
    return ref.knowsPhrase + " This round's answer: " + valueText + ". " + narrowingText;
  }

  function allNodes() {
    return DATA.NODES.slice();
  }

  function clearChildren(el) {
    el.textContent = "";
  }

  function appendLog(logEl, text) {
    var li = document.createElement("li");
    li.textContent = text;
    logEl.appendChild(li);
  }

  // "Candidates: 20 → 9 (11 eliminated)." — geçmiş tur geçmişte
  // kalmasın diye hem bu paragrafa hem de çağıranın log satırına
  // eklenir. 8 ya da altında kalan adaylar adlarıyla listelenir.
  function candidatesSummary(candidates, prevCount) {
    var text;
    if (prevCount === undefined) {
      text = candidates.length + " candidates remain (no questions asked yet).";
    } else {
      var eliminated = prevCount - candidates.length;
      text = "Candidates: " + prevCount + " → " + candidates.length +
        " (" + eliminated + " eliminated).";
    }
    if (candidates.length <= 8) {
      var titles = [];
      for (var i = 0; i < candidates.length; i++) titles.push(candidates[i].title);
      text += " Remaining: " + titles.join(", ") + ".";
    }
    return text;
  }

  function renderCandidates(el, candidates, prevCount) {
    el.textContent = candidatesSummary(candidates, prevCount);
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  // --- DOM referansları (init() içinde doldurulur) ---
  var tabWatchBtn, tabPlayBtn, simWatchEl, simPlayEl;
  var watchLogEl, watchCandidatesEl, watchNextBtn, watchAutoBtn, watchResetBtn;
  var playLogEl, playCandidatesEl, playMenuEl, playGuessBtn, playGuessListEl,
    playResultEl, playResetBtn, playAllAskedEl, playGuessesLeftEl;

  var MAX_WRONG_GUESSES = 3;

  // --- İzleme modu ---
  var watchState;

  function stopAutoWatch() {
    if (watchState && watchState.autoTimer) {
      clearTimeout(watchState.autoTimer);
      watchState.autoTimer = null;
    }
    if (watchState) watchState.autoOn = false;
    watchAutoBtn.textContent = "Auto-play";
    watchAutoBtn.setAttribute("aria-pressed", "false");
  }

  function scheduleAutoWatch() {
    watchState.autoTimer = setTimeout(function () {
      watchNextRound();
      if (watchState && watchState.autoOn && !watchState.finished) {
        scheduleAutoWatch();
      } else {
        stopAutoWatch();
      }
    }, 2500);
  }

  function toggleAutoWatch() {
    if (prefersReducedMotion() || !watchState || watchState.finished) return;
    if (watchState.autoOn) {
      stopAutoWatch();
    } else {
      watchState.autoOn = true;
      watchAutoBtn.textContent = "Pause";
      watchAutoBtn.setAttribute("aria-pressed", "true");
      scheduleAutoWatch();
    }
  }

  function watchCapture() {
    appendLog(watchLogEl, "Hunter captures " + watchState.secretNode.title + ". Correct — match over.");
    watchState.finished = true;
    watchNextBtn.disabled = true;
    watchAutoBtn.disabled = true;
  }

  function watchNextRound() {
    if (!watchState || watchState.finished) return;
    var beforeCount = watchState.candidates.length;
    var hakemId = DATA.WATCH_SCRIPT[watchState.roundIndex];
    var result = askReferee(hakemId, watchState.candidates, watchState.secretNode);
    watchState.candidates = result.candidates;
    watchState.roundIndex++;
    var answer = buildAnswerText(result.referee, result.value, beforeCount, result.candidates.length);
    appendLog(watchLogEl, result.referee.name + " was asked about " + result.referee.question +
      ". " + answer + " " + candidatesSummary(result.candidates, beforeCount));
    renderCandidates(watchCandidatesEl, watchState.candidates, beforeCount);
    if (watchState.roundIndex >= DATA.WATCH_SCRIPT.length) {
      watchCapture();
    }
  }

  // Sayfa yüklenince ve her Reset'te YENİ bir gizli yer seçilir
  // (SIM-RASTGELE-1) — art arda aynı yer gelebilir, bu kasıtlı.
  function resetWatch() {
    stopAutoWatch();
    watchState = {
      secretNode: pickRandomSecret(),
      candidates: allNodes(),
      roundIndex: 0,
      finished: false,
      autoTimer: null,
      autoOn: false
    };
    clearChildren(watchLogEl);
    renderCandidates(watchCandidatesEl, watchState.candidates, undefined);
    watchNextBtn.disabled = false;
    watchAutoBtn.disabled = prefersReducedMotion();
    watchAutoBtn.textContent = "Auto-play";
    watchAutoBtn.setAttribute("aria-pressed", "false");
  }

  // --- Oynama modu ---
  var playState;

  function renderPlayMenu() {
    clearChildren(playMenuEl);
    for (var i = 0; i < DATA.REFEREES.length; i++) {
      var ref = DATA.REFEREES[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Ask " + ref.name + ": " + ref.question;
      var asked = playState.askedIds.indexOf(ref.id) !== -1;
      btn.disabled = asked || playState.finished;
      (function (hakemId) {
        btn.addEventListener("click", function () {
          playAsk(hakemId);
        });
      })(ref.id);
      playMenuEl.appendChild(btn);
    }
  }

  function updatePlayNote() {
    if (!playState.finished && playState.askedIds.length >= DATA.REFEREES.length) {
      playAllAskedEl.textContent = "All Referees asked — time to guess.";
    } else {
      playAllAskedEl.textContent = "";
    }
  }

  function playAsk(hakemId) {
    if (!playState || playState.finished) return;
    if (playState.askedIds.indexOf(hakemId) !== -1) return;
    var beforeCount = playState.candidates.length;
    var result = askReferee(hakemId, playState.candidates, playState.secretNode);
    playState.candidates = result.candidates;
    playState.askedIds.push(hakemId);
    var answer = buildAnswerText(result.referee, result.value, beforeCount, result.candidates.length);
    appendLog(playLogEl, result.referee.name + " was asked about " + result.referee.question +
      ". " + answer + " " + candidatesSummary(result.candidates, beforeCount));
    renderCandidates(playCandidatesEl, playState.candidates, beforeCount);
    renderPlayMenu();
    updatePlayNote();
  }

  function updateGuessesLeftDisplay() {
    playGuessesLeftEl.textContent = "Guesses left: " + playState.guessesLeft + ".";
  }

  function renderGuessList() {
    clearChildren(playGuessListEl);
    for (var i = 0; i < playState.candidates.length; i++) {
      var node = playState.candidates[i];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Guess: " + node.title;
      (function (chosenId) {
        btn.addEventListener("click", function () {
          playGuess(chosenId);
        });
      })(node.id);
      playGuessListEl.appendChild(btn);
    }
    playGuessListEl.hidden = false;
    playGuessBtn.setAttribute("aria-expanded", "true");
  }

  function hideGuessList() {
    playGuessListEl.hidden = true;
    playGuessBtn.setAttribute("aria-expanded", "false");
  }

  // Doğru tahmin ya da 3. yanlış tahminde oyun biter; 1./2. yanlış
  // tahmin o adayı listeden eler, hakkı 1 azaltır, oyun SÜRER —
  // Hakem soruları (renderPlayMenu zaten `finished`e bakar) ve
  // kalan aday daralması bundan BAĞIMSIZ işlemeye devam eder. Yanlış
  // tahmin mesajı TEK yerde (günlükte) görünür; alttaki sonuç
  // paragrafı yalnız oyun gerçekten bittiğinde yazılır.
  function playGuess(chosenId) {
    if (!playState || playState.finished) return;
    var correct = chosenId === playState.secretNode.id;
    if (correct) {
      playState.finished = true;
      var questionsAsked = playState.askedIds.length;
      var wrongGuesses = MAX_WRONG_GUESSES - playState.guessesLeft;
      var resultText = "Correct — you caught " + playState.secretNode.title + ". You asked " +
        questionsAsked + " question" + (questionsAsked === 1 ? "" : "s") + " and made " +
        wrongGuesses + " wrong guess" + (wrongGuesses === 1 ? "" : "es") + " along the way. " +
        "In a real match, reaching the Fugitive's page and guessing right ends the match " +
        "in the Hunter's favor.";
      playResultEl.textContent = resultText;
      appendLog(playLogEl, resultText);
      hideGuessList();
      playGuessBtn.disabled = true;
    } else {
      var chosen = nodeById(chosenId);
      var beforeCount = playState.candidates.length;
      playState.candidates = playState.candidates.filter(function (n) { return n.id !== chosenId; });
      playState.guessesLeft -= 1;
      if (playState.guessesLeft > 0) {
        appendLog(playLogEl, "Not quite — " + (chosen ? chosen.title : chosenId) +
          " wasn't it. That guess is removed from the candidates. Guesses left: " +
          playState.guessesLeft + ".");
        renderCandidates(playCandidatesEl, playState.candidates, beforeCount);
        updateGuessesLeftDisplay();
        renderGuessList();
      } else {
        playState.finished = true;
        var finalText = "Out of guesses — the hiding spot was " + playState.secretNode.title +
          ". You asked " + playState.askedIds.length + " question(s) and used all " +
          MAX_WRONG_GUESSES + " guesses.";
        playResultEl.textContent = finalText;
        appendLog(playLogEl, finalText);
        updateGuessesLeftDisplay();
        hideGuessList();
        playGuessBtn.disabled = true;
      }
    }
    renderPlayMenu();
    updatePlayNote();
  }

  // Sayfa yüklenince ve her Reset'te YENİ bir gizli yer seçilir
  // (SIM-RASTGELE-1) — Watch'unkinden BAĞIMSIZ, art arda aynı yer
  // gelebilir.
  function resetPlay() {
    playState = {
      secretNode: pickRandomSecret(),
      candidates: allNodes(),
      askedIds: [],
      guessesLeft: MAX_WRONG_GUESSES,
      finished: false
    };
    clearChildren(playLogEl);
    clearChildren(playGuessListEl);
    hideGuessList();
    playGuessBtn.disabled = false;
    playResultEl.textContent = "";
    // Sonuç mesajı artık yalnız günlükte (role="log" aria-live="polite")
    // görünür; bu paragraf gerçek bir aria-live taşıyıcısı DEĞİLDİ (düz
    // <p>, rol/aria-live yok) — görsel tekrarı önlemek için native
    // `hidden` ile kalıcı olarak gizlenir (CSS'e dokunmadan, scope
    // dışı). Metni (textContent ataması) DEĞİŞMEDİ, yalnız görünürlük.
    playResultEl.hidden = true;
    renderCandidates(playCandidatesEl, playState.candidates, undefined);
    renderPlayMenu();
    updatePlayNote();
    updateGuessesLeftDisplay();
  }

  // --- Sekmeler ---
  // Her geçiş (Watch/Play tıklaması) hedef modun durumunu TAMAMEN
  // sıfırlar (turlar, adaylar, mesajlar) ve İzleme'nin otomatik
  // oynatma zamanlayıcısını — hangi yöne geçilirse geçilsin — durdurur,
  // böylece arka planda çalışan bir zamanlayıcı kalmaz.
  function showTab(which) {
    stopAutoWatch();
    var watchOn = which === "watch";
    simWatchEl.hidden = !watchOn;
    simPlayEl.hidden = watchOn;
    tabWatchBtn.setAttribute("aria-selected", watchOn ? "true" : "false");
    tabPlayBtn.setAttribute("aria-selected", watchOn ? "false" : "true");
    if (watchOn) {
      resetWatch();
    } else {
      resetPlay();
    }
  }

  function init() {
    simWatchEl = document.getElementById("sim-watch");
    simPlayEl = document.getElementById("sim-play");
    if (!simWatchEl || !simPlayEl) return;

    tabWatchBtn = document.getElementById("sim-tab-watch");
    tabPlayBtn = document.getElementById("sim-tab-play");

    watchLogEl = document.getElementById("sim-watch-log");
    watchCandidatesEl = document.getElementById("sim-watch-candidates");
    watchNextBtn = document.getElementById("sim-watch-next");
    watchAutoBtn = document.getElementById("sim-watch-auto");
    watchResetBtn = document.getElementById("sim-watch-reset");

    playLogEl = document.getElementById("sim-play-log");
    playCandidatesEl = document.getElementById("sim-play-candidates");
    playMenuEl = document.getElementById("sim-play-menu");
    playGuessBtn = document.getElementById("sim-play-guess-btn");
    playGuessListEl = document.getElementById("sim-play-guess-list");
    playResultEl = document.getElementById("sim-play-result");
    playResetBtn = document.getElementById("sim-play-reset");
    playAllAskedEl = document.getElementById("sim-play-allasked");
    playGuessesLeftEl = document.getElementById("sim-play-guesses-left");

    tabWatchBtn.addEventListener("click", function () { showTab("watch"); });
    tabPlayBtn.addEventListener("click", function () { showTab("play"); });

    watchNextBtn.addEventListener("click", watchNextRound);
    watchAutoBtn.addEventListener("click", toggleAutoWatch);
    watchResetBtn.addEventListener("click", resetWatch);

    playGuessBtn.addEventListener("click", renderGuessList);
    playResetBtn.addEventListener("click", resetPlay);

    resetWatch();
    resetPlay();
    showTab("watch");
  }

  init();
})();
