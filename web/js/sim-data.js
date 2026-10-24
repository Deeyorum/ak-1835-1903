(function () {
  "use strict";

  // Fully invented world for the Kindi-page simulation. Not the real
  // game world, not a real Wikipedia title. "category" groups nodes
  // the same way the real game's "kategori" slice does; "bölge"
  // (distance band) is computed at runtime from EDGES, not stored
  // here, so it can never drift out of sync with the graph.
  //
  // Data invariant (checked by /tmp verification script, SIM-RASTGELE-1):
  // for EVERY node here, if it were the hiding spot, asking all 3
  // Referees (bölge, kategori, harf, in that order) must narrow the
  // 20 candidates down to exactly that 1 node — otherwise a random
  // secret could leave Play mode's "Guess" list with more than one
  // name even after all Referees are asked. n19/n20 were moved out of
  // "Forgotten Signals" (into "Keeper Halls"/"Hidden Machines") to fix
  // two same-first-letter collisions ("Scheme Static"/"Salt Crossing"
  // both "S"; "Null Frequency"/"Nonce Marsh" both "N") that otherwise
  // left 2 candidates standing. Category group sizes are no longer
  // even (5/6/6/3) as a result — titles/graph were not touched.
  var NODES = [
    { id: "n1", title: "Scytalia Ridge", category: "Cipher Settlements" },
    { id: "n2", title: "Vigenara Atoll", category: "Cipher Settlements" },
    { id: "n3", title: "Cipheron Hollow", category: "Cipher Settlements" },
    { id: "n4", title: "Playfaria Bluff", category: "Cipher Settlements" },
    { id: "n5", title: "Trithemia Cove", category: "Cipher Settlements" },
    { id: "n6", title: "Rotor Garrison", category: "Hidden Machines" },
    { id: "n7", title: "Bombeshire Hollow", category: "Hidden Machines" },
    { id: "n8", title: "Lorenzia Works", category: "Hidden Machines" },
    { id: "n9", title: "Purlum Loom", category: "Hidden Machines" },
    { id: "n10", title: "Fialkara Yard", category: "Hidden Machines" },
    { id: "n11", title: "Ward Hollow", category: "Keeper Halls" },
    { id: "n12", title: "Archivum Tower", category: "Keeper Halls" },
    { id: "n13", title: "Cipher Chapel", category: "Keeper Halls" },
    { id: "n14", title: "Tally Court", category: "Keeper Halls" },
    { id: "n15", title: "Glyph Hall", category: "Keeper Halls" },
    { id: "n16", title: "Scheme Static", category: "Forgotten Signals" },
    { id: "n17", title: "Null Frequency", category: "Forgotten Signals" },
    { id: "n18", title: "Padding Shoals", category: "Forgotten Signals" },
    { id: "n19", title: "Nonce Marsh", category: "Keeper Halls" },
    { id: "n20", title: "Salt Crossing", category: "Hidden Machines" }
  ];

  // Undirected for simplicity (the real game's link graph is
  // directed; this toy does not model that distinction).
  var EDGES = [
    ["n1", "n2"], ["n1", "n3"], ["n2", "n4"], ["n3", "n4"], ["n3", "n5"],
    ["n4", "n6"], ["n5", "n7"], ["n6", "n7"], ["n6", "n8"], ["n7", "n9"],
    ["n8", "n10"], ["n9", "n10"], ["n9", "n11"], ["n10", "n12"],
    ["n11", "n12"], ["n11", "n13"], ["n12", "n14"], ["n13", "n14"],
    ["n13", "n15"], ["n14", "n16"], ["n15", "n16"], ["n15", "n17"],
    ["n16", "n18"], ["n17", "n18"], ["n17", "n19"], ["n18", "n20"],
    ["n19", "n20"]
  ];

  var HUNTER_START = "n1";
  // Gizli yer artık burada sabit DEĞİL — sim.js sayfa yüklenince ve
  // her Reset'te NODES içinden rastgele seçer (SIM-RASTGELE-1).

  // "question" bir ad öbeği (sim.js bunu "Ask Referee X: <question>"
  // şeklinde düğme metnine çevirir). "knowsPhrase" SPEC §6'nın "her
  // hakem yalnız kendi dilimini bilir" kuralını sabit, maça bağlı
  // olmayan bir cümleyle anlatır.
  var REFEREES = [
    {
      id: "ref-bolge",
      name: "Referee Bearing",
      dilimTuru: "bolge",
      question: "the distance band to the Hunter's starting point",
      knowsPhrase: "Referee Bearing only knows the distance band between the hiding spot and the Hunter's starting point — near, mid, or far, never the exact number of hops.",
      valuePhrase: "the hiding spot is in the \"{value}\" distance band"
    },
    {
      id: "ref-kategori",
      name: "Referee Index",
      dilimTuru: "kategori",
      question: "the hiding spot's category",
      knowsPhrase: "Referee Index only knows which category the hiding spot's page belongs to, nothing about distance or the name itself.",
      valuePhrase: "the hiding spot's category is \"{value}\""
    },
    {
      id: "ref-harf",
      name: "Referee Letter",
      dilimTuru: "harf",
      question: "the first letter of the hiding spot's name",
      knowsPhrase: "Referee Letter only knows the first letter of the hiding spot's name, nothing else about it.",
      valuePhrase: "the hiding spot's name starts with \"{value}\""
    }
  ];

  // Fixed order for Watch mode's scripted, pre-recorded match.
  var WATCH_SCRIPT = ["ref-bolge", "ref-kategori", "ref-harf"];

  // Play mode: real game runs up to 30 rounds (src/game/setup.ts,
  // DEFAULT_TURN_LIMIT); this toy only has 3 referees to ask.
  var MAX_PLAY_ROUNDS = REFEREES.length;
  var REAL_GAME_TURN_LIMIT = 30;

  window.AK_SIM_DATA = {
    NODES: NODES,
    EDGES: EDGES,
    HUNTER_START: HUNTER_START,
    REFEREES: REFEREES,
    WATCH_SCRIPT: WATCH_SCRIPT,
    MAX_PLAY_ROUNDS: MAX_PLAY_ROUNDS,
    REAL_GAME_TURN_LIMIT: REAL_GAME_TURN_LIMIT
  };
})();
