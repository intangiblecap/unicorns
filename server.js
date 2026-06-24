const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static('public'));

const rooms = {};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildDeck() {
  let id = 0;
  const cards = [];

  const basics = ['Licorne Narval','Licorne Vampire','Licorne Zombie','Licorne Ninja','Licorne Robot','Licorne Pirate','Licorne Cowboy','Licorne Astronaute'];
  basics.forEach(name => {
    for(let i=0;i<2;i++) cards.push({id:id++,name,type:'basic',desc:'Licorne Standard. Aucun effet.'});
  });

  [
    {name:'Licorne Mystique',effect:'draw1',desc:'Lorsque cette carte entre dans votre Écurie : PIOCHEZ 1 carte.'},
    {name:'Licorne Cupidon',effect:'nursery',desc:'Lorsque cette carte entre dans votre Écurie : amenez 1 Bébé Licorne de la Nurserie dans votre Écurie.'},
    {name:'Licorne Ange',effect:'revive',desc:'Lorsque cette carte entre dans votre Écurie : prenez 1 carte de la défausse en main.'},
    {name:'Licorne Chaos',effect:'steal',desc:'Lorsque cette carte entre dans votre Écurie : VOLEZ 1 Licorne de l\'Écurie d\'un autre joueur.'},
    {name:'Licorne Protectrice',effect:'protection',desc:'Les cartes Illico ne peuvent pas être jouées contre vous.'},
    {name:'Licorne Destructrice',effect:'destroy_on_enter',desc:'Lorsque cette carte entre dans votre Écurie : DÉTRUISEZ 1 carte de l\'Écurie d\'un autre joueur.'},
  ].forEach(c => cards.push({id:id++,...c,type:'magic'}));

  [
    {name:'Corne Magique',effect:'extra_point',desc:'Votre Écurie a besoin d\'1 Licorne de moins pour gagner.'},
    {name:'Glitter Bomb',effect:'draw_when_attacked',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉTRUIRE 1 carte d\'une autre Écurie.'},
    {name:'Écurie Enchantée',effect:'begin_discard1_draw1',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉFAUSSER 1 carte puis PIOCHER 1 carte.'},
    {name:'Miroir des Âmes',effect:'begin_discard2_steal_baby',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉFAUSSER 2 cartes puis amener 1 Bébé Licorne de la Nurserie dans votre Écurie.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'upgrade'}); });

  [
    {name:'Mauvais Sort',effect:'skip_draw',desc:'Le joueur dont l\'Écurie contient cette carte ne peut pas PIOCHER pendant sa Phase de Pioche.'},
    {name:'Voleur de Corne',effect:'no_unicorn',desc:'Le joueur dont l\'Écurie contient cette carte ne peut pas amener de Licorne dans son Écurie.'},
    {name:'Ralentissement',effect:'hand_limit_5',desc:'Le joueur dont l\'Écurie contient cette carte a une limite de main de 5 cartes.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'attack'}); });

  [
    {name:'Récolte Arc-en-ciel',effect:'draw2',desc:'PIOCHEZ 2 cartes.'},
    {name:'Tempête de Licornes',effect:'draw3',desc:'PIOCHEZ 3 cartes.'},
    {name:'Destruction',effect:'destroy',desc:'DÉTRUISEZ 1 carte de l\'Écurie d\'un autre joueur.'},
    {name:'Vol',effect:'steal_spell',desc:'VOLEZ 1 Licorne de l\'Écurie d\'un autre joueur.'},
    {name:'Retour à la Nurserie',effect:'return',desc:'Retournez 1 Licorne de l\'Écurie d\'un autre joueur à la Nurserie.'},
    {name:'Rituel Sadique',effect:'all_discard1',desc:'Chaque autre joueur doit DÉFAUSSER 1 carte.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'spell'}); });

  [
    {name:'Huuue !!',effect:'nope',desc:'Jouez cette carte pour annuler la carte jouée par l\'adversaire, ou pour contrer un Huuue !! joué contre vous.'},
  ].forEach(c => { for(let i=0;i<6;i++) cards.push({id:id++,...c,type:'instant'}); });

  return shuffle(cards);
}

function buildNursery() {
  let id = 2000;
  const babies = ['Bébé Arc-en-ciel','Bébé Étoile','Bébé Nuage','Bébé Doré','Bébé Magique','Bébé Paillette'];
  const n = [];
  babies.forEach(name => { for(let i=0;i<3;i++) n.push({id:id++,name,type:'baby',desc:'Bébé Licorne. Aucun effet.'}); });
  return shuffle(n);
}

function winTarget(room) {
  return room.players.length >= 6 ? 6 : 7;
}

function checkWin(room) {
  const target = winTarget(room);
  for(const p of room.players) {
    const unicorns = p.stable.filter(c=>['baby','basic','magic'].includes(c.type)).length;
    const bonus = p.upgrades.filter(c=>c.effect==='extra_point').length;
    if(unicorns >= target - bonus) return p.id;
  }
  return null;
}

function initGame(room) {
  const deck = buildDeck();
  const nursery = buildNursery();
  room.players.forEach((p,i) => {
    p.hand = deck.splice(0,5);
    p.stable = [nursery[i]];
    p.upgrades = [];
    p.attacks = [];
  });
  room.deck = deck;
  room.nursery = nursery.slice(room.players.length);
  room.discard = [];
  room.currentPlayer = 0;
  room.phase = 'begin_of_turn';
  room.lastCard = null;
  room.pendingCard = null;
  room.usedBeginEffects = [];
  room.log = [`La partie commence ! Tour de ${room.players[0].name}`];
  room.started = true;
  room.winner = null;
}

function pickCard(pool, targetCardId) {
  if(targetCardId != null) return pool.find(c=>c.id===targetCardId) || pool[0];
  return pool[0];
}

function removeCard(player, cardId) {
  if(player.stable.some(c=>c.id===cardId))  { player.stable   = player.stable.filter(c=>c.id!==cardId); return; }
  if(player.upgrades.some(c=>c.id===cardId)) { player.upgrades = player.upgrades.filter(c=>c.id!==cardId); return; }
  if(player.attacks.some(c=>c.id===cardId))  { player.attacks  = player.attacks.filter(c=>c.id!==cardId); }
}

function applyCardEffect(room, card, actor, target, targetCardId=null) {
  if(['basic','magic'].includes(card.type)) {
    if(actor.attacks.some(d=>d.effect==='no_unicorn')) {
      actor.hand.push(card);
      room.log.push(`${actor.name} ne peut pas amener de Licorne (Voleur de Corne) !`);
      return false;
    }
    actor.stable.push(card);
    room.log.push(`${actor.name} amène ${card.name} dans son Écurie.`);
    if(card.effect==='draw1'&&room.deck.length>0){ actor.hand.push(room.deck.shift()); room.log.push(`${actor.name} pioche 1 carte.`); }
    if(card.effect==='nursery'&&room.nursery.length>0){ actor.stable.push(room.nursery.shift()); room.log.push(`${actor.name} amène un Bébé Licorne depuis la Nurserie.`); }
    if(card.effect==='revive'&&room.discard.length>0){ actor.hand.push(room.discard.pop()); room.log.push(`${actor.name} récupère une carte de la défausse.`); }
    if(card.effect==='steal'){
      const v=(target&&target.id!==actor.id)?target:null;
      if(v){ const uni=v.stable.filter(c=>['basic','magic'].includes(c.type)); if(uni.length>0){ const stolen=pickCard(uni,targetCardId); v.stable=v.stable.filter(c=>c.id!==stolen.id); actor.stable.push(stolen); room.log.push(`${actor.name} vole ${stolen.name} à ${v.name}.`); } }
    }
    if(card.effect==='destroy_on_enter'){
      if(target&&target.id!==actor.id){ const pool=[...target.stable,...target.upgrades,...target.attacks]; if(pool.length>0){ const v=pickCard(pool,targetCardId); removeCard(target,v.id); room.discard.push(v); room.log.push(`${actor.name} détruit ${v.name} de ${target.name}.`); } }
    }
  } else if(card.type==='upgrade') {
    target.upgrades.push(card);
    room.log.push(`${actor.name} joue ${card.name} dans l'Écurie de ${target.name}.`);
  } else if(card.type==='attack') {
    target.attacks.push(card);
    room.log.push(`${actor.name} joue ${card.name} dans l'Écurie de ${target.name}.`);
  } else if(card.type==='spell') {
    room.discard.push(card);
    if(card.effect==='draw2'){ for(let i=0;i<2&&room.deck.length>0;i++) actor.hand.push(room.deck.shift()); room.log.push(`${actor.name} pioche 2 cartes.`); }
    if(card.effect==='draw3'){ for(let i=0;i<3&&room.deck.length>0;i++) actor.hand.push(room.deck.shift()); room.log.push(`${actor.name} pioche 3 cartes.`); }
    if(card.effect==='destroy'){ const pool=[...target.stable,...target.upgrades,...target.attacks]; if(pool.length>0){ const v=pickCard(pool,targetCardId); removeCard(target,v.id); room.discard.push(v); room.log.push(`${actor.name} détruit ${v.name} de ${target.name}.`); } }
    if(card.effect==='steal_spell'){ const u=target.stable.filter(c=>['baby','basic','magic'].includes(c.type)); if(u.length>0){ const v=pickCard(u,targetCardId); target.stable=target.stable.filter(c=>c.id!==v.id); actor.stable.push(v); room.log.push(`${actor.name} vole ${v.name} à ${target.name}.`); } }
    if(card.effect==='return'){ const u=target.stable.filter(c=>['basic','magic','baby'].includes(c.type)); if(u.length>0){ const v=pickCard(u,targetCardId); target.stable=target.stable.filter(c=>c.id!==v.id); room.nursery.push(v); room.log.push(`${actor.name} renvoie ${v.name} à la Nurserie.`); } }
    if(card.effect==='all_discard1'){ room.players.filter(p=>p.id!==actor.id).forEach(p=>{ if(p.hand.length>0){ const d=p.hand.splice(Math.floor(Math.random()*p.hand.length),1)[0]; room.discard.push(d); room.log.push(`${p.name} défausse ${d.name}.`); } }); }
  }
  return true;
}

// Résout la carte en attente selon la chaîne de Huuue !!
function resolvePending(room) {
  if(!room.pendingCard) return;
  const { card, actorId, targetId, targetCardId, nopeChain } = room.pendingCard;
  room.pendingCard = null;
  const noped = (nopeChain||[]).length % 2 === 1;
  if(noped) {
    room.discard.push(card);
    room.log.push(`❌ ${card.name} est annulée par les Huuue !!`);
    return;
  }
  const cardActor = room.players.find(p=>p.id===actorId);
  const cardTarget = room.players.find(p=>p.id===targetId) || cardActor;
  if(cardActor) applyCardEffect(room, card, cardActor, cardTarget, targetCardId);
}

function getState(room, forPlayer) {
  return {
    me: forPlayer,
    players: room.players.map(p => ({
      id: p.id,
      name: p.name,
      stableCount: p.stable.filter(c=>['baby','basic','magic'].includes(c.type)).length,
      stable: p.stable,
      upgrades: p.upgrades,
      attacks: p.attacks,
      handCount: p.hand.length,
      isCurrentPlayer: room.currentPlayer === room.players.indexOf(p),
    })),
    currentPlayer: room.currentPlayer,
    phase: room.phase,
    lastCard: room.lastCard,
    pendingCard: room.pendingCard,
    usedBeginEffects: room.usedBeginEffects || [],
    deckCount: room.deck.length,
    winTarget: winTarget(room),
    log: room.log.slice(-15),
    winner: room.winner,
  };
}

function broadcast(room) {
  room.players.forEach(p => {
    io.to(p.socketId).emit('state', getState(room, p));
  });
}

const WORDS = ['lapin','licorne','nuage','etoile','gateau','soleil','jardin','mouton','bateau','pirate','dragon','flacon','bouton','carton','citron','melon','salon','ballon','facon','maison'];
function genCode() { return WORDS[Math.floor(Math.random()*WORDS.length)]; }

io.on('connection', socket => {
  socket.on('create', ({ name }) => {
    let roomId;
    do { roomId = genCode(); } while (rooms[roomId]);
    rooms[roomId] = { id: roomId, players: [], deck: [], nursery: [], discard: [], currentPlayer: 0, phase: 'begin_of_turn', log: [], started: false, winner: null, lastCard: null, pendingCard: null, usedBeginEffects: [] };
    const player = { id: 0, socketId: socket.id, name, hand: [], stable: [], upgrades: [], attacks: [] };
    rooms[roomId].players.push(player);
    socket.join(roomId);
    socket.data = { roomId, playerId: 0 };
    socket.emit('created', { roomId, playerId: 0 });
    socket.emit('joined', { playerId: 0 });
    io.to(roomId).emit('lobby', { players: rooms[roomId].players.map(p=>({id:p.id,name:p.name})), roomId, hostId: 0 });
  });

  socket.on('join', ({ roomId, name }) => {
    if(!rooms[roomId]) {
      rooms[roomId] = { id: roomId, players: [], deck: [], nursery: [], discard: [], currentPlayer: 0, phase: 'begin_of_turn', log: [], started: false, winner: null, lastCard: null, pendingCard: null, usedBeginEffects: [] };
    }
    const room = rooms[roomId];
    if(room.started) { socket.emit('error','Partie déjà commencée !'); return; }
    if(room.players.length >= 8) { socket.emit('error','Salle pleine !'); return; }
    const player = { id: room.players.length, socketId: socket.id, name, hand: [], stable: [], upgrades: [], attacks: [] };
    room.players.push(player);
    socket.join(roomId);
    socket.data = { roomId, playerId: player.id };
    io.to(roomId).emit('lobby', { players: room.players.map(p=>({id:p.id,name:p.name})), roomId, hostId: 0 });
    socket.emit('joined', { playerId: player.id });
  });

  socket.on('start', () => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms[roomId];
    if(!room || playerId !== 0 || room.players.length < 2) return;
    initGame(room);
    broadcast(room);
  });

  socket.on('action', ({ type, cardId, targetPlayerId, targetCardId, discardIds }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms[roomId];
    if(!room || !room.started || room.winner !== null) return;
    const cp = room.players[room.currentPlayer];
    const actor = room.players.find(p=>p.id===playerId);
    if(!actor) return;

    // Huuue !! — jouable par n'importe qui pendant begin_of_turn si pendingCard
    if(type === 'nope') {
      if(!room.pendingCard || room.phase !== 'begin_of_turn') return;
      const pendingActor = room.players.find(p=>p.id===room.pendingCard.actorId);
      const chainLen = (room.pendingCard.nopeChain||[]).length;
      // Licorne Protectrice : bloque le premier Huuue !! contre le joueur protégé
      if(chainLen === 0 && pendingActor && pendingActor.upgrades.some(u=>u.effect==='protection') && actor.id!==pendingActor.id) return;
      const cardIdx = actor.hand.findIndex(c=>c.id===cardId && c.effect==='nope');
      if(cardIdx === -1) return;
      const nopeCard = actor.hand.splice(cardIdx, 1)[0];
      room.discard.push(nopeCard);
      room.lastCard = nopeCard;
      if(!room.pendingCard.nopeChain) room.pendingCard.nopeChain = [];
      room.pendingCard.nopeChain.push({ playerId: actor.id, playerName: actor.name });
      const n = room.pendingCard.nopeChain.length;
      room.log.push(`🙅 ${actor.name} joue Huuue !! (${n} total — carte ${n%2===1?'annulée':'en jeu'} si personne ne contre)`);
      broadcast(room);
      return;
    }

    // À partir d'ici, seul le joueur courant peut agir
    if(cp.id !== playerId) return;

    // Début de tour : effets de début + piocher
    if(type === 'use_begin') {
      if(room.phase !== 'begin_of_turn') return;
      const upgradeCard = cp.upgrades.find(c=>c.id===cardId);
      if(!upgradeCard || (room.usedBeginEffects||[]).includes(cardId)) return;

      if(upgradeCard.effect === 'begin_discard1_draw1') {
        if(!discardIds || discardIds.length !== 1) return;
        const idx = cp.hand.findIndex(c=>c.id===discardIds[0]);
        if(idx === -1) return;
        const discarded = cp.hand.splice(idx, 1)[0];
        room.discard.push(discarded);
        if(room.deck.length > 0) cp.hand.push(room.deck.shift());
        room.usedBeginEffects.push(cardId);
        room.log.push(`${cp.name} active Écurie Enchantée : défausse ${discarded.name}, pioche 1 carte.`);
        broadcast(room); return;
      }

      if(upgradeCard.effect === 'begin_discard2_steal_baby') {
        if(!discardIds || discardIds.length !== 2) return;
        const ids = [...new Set(discardIds)];
        if(ids.length !== 2) return;
        const indices = ids.map(id=>cp.hand.findIndex(c=>c.id===id));
        if(indices.some(i=>i===-1)) return;
        indices.sort((a,b)=>b-a);
        const discarded = indices.map(i=>cp.hand.splice(i,1)[0]);
        room.discard.push(...discarded);
        if(room.nursery.length > 0) { const baby=room.nursery.shift(); cp.stable.push(baby); room.log.push(`${cp.name} active Miroir des Âmes : défausse 2 cartes, amène ${baby.name} !`); }
        else { room.log.push(`${cp.name} active Miroir des Âmes : Nurserie vide.`); }
        room.usedBeginEffects.push(cardId);
        broadcast(room); return;
      }

      if(upgradeCard.effect === 'draw_when_attacked') {
        const t = room.players.find(p=>p.id===targetPlayerId);
        if(!t || t.id===cp.id) return;
        const allCards = [...t.stable, ...t.upgrades, ...t.attacks];
        if(allCards.length === 0) return;
        const toDestroy = pickCard(allCards, targetCardId) || allCards[0];
        removeCard(t, toDestroy.id);
        room.discard.push(toDestroy);
        room.usedBeginEffects.push(cardId);
        room.log.push(`${cp.name} active Glitter Bomb : détruit ${toDestroy.name} de ${t.name}.`);
        broadcast(room); return;
      }
      return;
    }

    // Piocher : résout d'abord la pendingCard, puis pioche
    if(type === 'draw') {
      if(room.phase !== 'begin_of_turn') return;
      // Résoudre la carte en attente avant de piocher
      resolvePending(room);
      const w = checkWin(room);
      if(w !== null){ room.winner=w; room.log.push(`🏆 ${room.players[w].name} a gagné !`); broadcast(room); return; }
      // Mauvais Sort : pas de pioche
      if(cp.attacks.some(d=>d.effect==='skip_draw')) {
        room.log.push(`${cp.name} ne peut pas piocher (Mauvais Sort).`);
        room.phase = 'action';
      } else {
        if(room.deck.length > 0) { cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche une carte.`); }
        room.phase = 'action';
      }
      broadcast(room); return;
    }

    // Phase action
    if(type === 'skip') {
      if(room.phase !== 'action') return;
      room.phase = 'end';
      room.log.push(`${cp.name} passe son action.`);
      broadcast(room); return;
    }

    if(type === 'redraw') {
      if(room.phase !== 'action') return;
      if(room.deck.length > 0) { cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche (action).`); }
      room.phase = 'end';
      broadcast(room); return;
    }

    if(type === 'play') {
      if(room.phase !== 'action') return;
      const cardIdx = cp.hand.findIndex(c=>c.id===cardId);
      if(cardIdx === -1) return;
      const card = cp.hand.splice(cardIdx, 1)[0];
      const target = room.players.find(p=>p.id===targetPlayerId) || cp;
      room.lastCard = card;
      // La carte va en attente — le joueur suivant devra piocher pour la résoudre
      room.pendingCard = { card, actorId: cp.id, targetId: target.id, targetCardId: targetCardId||null, nopeChain: [] };
      room.log.push(`${cp.name} joue ${card.name}${target.id!==cp.id?' sur '+target.name:''}. Huuue !! possible jusqu'à la prochaine pioche !`);
      room.phase = 'end';
      broadcast(room); return;
    }

    // Fin de tour
    if(type === 'endturn') {
      if(room.phase !== 'end') return;
      const limit = cp.attacks.some(d=>d.effect==='hand_limit_5') ? 5 : 7;
      while(cp.hand.length > limit) { room.discard.push(cp.hand.pop()); }
      room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
      room.phase = 'begin_of_turn';
      room.usedBeginEffects = [];
      // pendingCard persiste intentionnellement jusqu'à la pioche du joueur suivant
      room.log.push(`--- Tour de ${room.players[room.currentPlayer].name} ---`);
      broadcast(room); return;
    }
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if(!roomId || !rooms[roomId]) return;
    const room = rooms[roomId];
    room.players = room.players.filter(p=>p.socketId!==socket.id);
    if(room.players.length===0) { delete rooms[roomId]; return; }
    if(room.started) {
      if(room.currentPlayer >= room.players.length) room.currentPlayer = 0;
      broadcast(room);
    }
  });
});

server.listen(3000, () => console.log('🦄 Serveur lancé sur port 3000'));
