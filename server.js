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

  // Licornes Standards (pas d'effet)
  const basics = ['Licorne Narval','Licorne Vampire','Licorne Zombie','Licorne Ninja','Licorne Robot','Licorne Pirate','Licorne Cowboy','Licorne Astronaute'];
  basics.forEach(name => {
    for(let i=0;i<2;i++) cards.push({id:id++,name,type:'basic',desc:'Licorne Standard. Aucun effet.'});
  });

  // Licornes Magiques
  [
    {name:'Licorne Mystique',effect:'draw1',desc:'Lorsque cette carte entre dans votre Écurie : PIOCHEZ 1 carte.'},
    {name:'Licorne Cupidon',effect:'nursery',desc:'Lorsque cette carte entre dans votre Écurie : amenez 1 Bébé Licorne de la Nurserie dans votre Écurie.'},
    {name:'Licorne Ange',effect:'revive',desc:'Lorsque cette carte entre dans votre Écurie : prenez 1 carte de la défausse en main.'},
    {name:'Licorne Chaos',effect:'steal',desc:'Lorsque cette carte entre dans votre Écurie : VOLEZ 1 Licorne de l\'Écurie d\'un autre joueur.'},
    {name:'Licorne Protectrice',effect:'protection',desc:'Les cartes Illico ne peuvent pas être jouées contre vous.'},
    {name:'Licorne Destructrice',effect:'destroy_on_enter',desc:'Lorsque cette carte entre dans votre Écurie : DÉTRUISEZ 1 carte de l\'Écurie d\'un autre joueur.'},
  ].forEach(c => cards.push({id:id++,...c,type:'magic'}));

  // Améliorations (jouables dans l'Écurie de n'importe quel joueur)
  [
    {name:'Corne Magique',effect:'extra_point',desc:'Votre Écurie a besoin d\'1 Licorne de moins pour gagner.'},
    {name:'Glitter Bomb',effect:'draw_when_attacked',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉTRUIRE 1 carte d\'une autre Écurie.'},
    {name:'Écurie Enchantée',effect:'begin_discard1_draw1',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉFAUSSER 1 carte puis PIOCHER 1 carte.'},
    {name:'Miroir des Âmes',effect:'begin_discard2_steal_baby',desc:'Si cette carte se trouve dans votre Écurie au début de votre tour : vous pouvez DÉFAUSSER 2 cartes puis amener 1 Bébé Licorne de la Nurserie dans votre Écurie.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'upgrade'}); });

  // Attaques (dans l'Écurie d'un adversaire)
  [
    {name:'Mauvais Sort',effect:'skip_draw',desc:'Le joueur dont l\'Écurie contient cette carte ne peut pas PIOCHER pendant sa Phase de Pioche.'},
    {name:'Voleur de Corne',effect:'no_unicorn',desc:'Le joueur dont l\'Écurie contient cette carte ne peut pas amener de Licorne dans son Écurie.'},
    {name:'Ralentissement',effect:'hand_limit_5',desc:'Le joueur dont l\'Écurie contient cette carte a une limite de main de 5 cartes.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'attack'}); });

  // Magie (effet unique, va à la défausse)
  [
    {name:'Récolte Arc-en-ciel',effect:'draw2',desc:'PIOCHEZ 2 cartes.'},
    {name:'Tempête de Licornes',effect:'draw3',desc:'PIOCHEZ 3 cartes.'},
    {name:'Destruction',effect:'destroy',desc:'DÉTRUISEZ 1 carte de l\'Écurie d\'un autre joueur.'},
    {name:'Vol',effect:'steal_spell',desc:'VOLEZ 1 Licorne de l\'Écurie d\'un autre joueur.'},
    {name:'Retour à la Nurserie',effect:'return',desc:'Retournez 1 Licorne de l\'Écurie d\'un autre joueur à la Nurserie.'},
    {name:'Rituel Sadique',effect:'all_discard1',desc:'Chaque autre joueur doit DÉFAUSSER 1 carte.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'spell'}); });

  // Illico
  [
    {name:'Huuue !!',effect:'nope',desc:'Jouez cette carte lorsqu\'un adversaire joue une carte depuis sa main pour en annuler l\'effet.'},
    {name:'Youpi !!',effect:'yep',desc:'Jouez cette carte pour annuler un Huuue !! joué contre vous.'},
  ].forEach(c => { for(let i=0;i<3;i++) cards.push({id:id++,...c,type:'instant'}); });

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

function applyCardEffect(room, card, actor, target) {
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
      const victims = room.players.filter(p=>p.id!==actor.id&&p.stable.filter(c=>['basic','magic'].includes(c.type)).length>0);
      if(victims.length>0){ const v=victims[0]; const uni=v.stable.filter(c=>['basic','magic'].includes(c.type)); const stolen=uni[Math.floor(Math.random()*uni.length)]; v.stable=v.stable.filter(c=>c.id!==stolen.id); actor.stable.push(stolen); room.log.push(`${actor.name} vole ${stolen.name} à ${v.name}.`); }
    }
    if(card.effect==='destroy_on_enter'){
      if(target && target.id !== actor.id){
        const uni=target.stable.filter(c=>['basic','magic','baby'].includes(c.type));
        if(uni.length>0){ const v=uni[0]; target.stable=target.stable.filter(c=>c.id!==v.id); room.discard.push(v); room.log.push(`${actor.name} détruit ${v.name} de ${target.name}.`); }
      }
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
    if(card.effect==='destroy'){ const u=target.stable.filter(c=>['basic','magic'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); room.discard.push(v); room.log.push(`${actor.name} détruit ${v.name} de ${target.name}.`); } }
    if(card.effect==='steal_spell'){ const u=target.stable.filter(c=>['basic','magic'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); actor.stable.push(v); room.log.push(`${actor.name} vole ${v.name} à ${target.name}.`); } }
    if(card.effect==='return'){ const u=target.stable.filter(c=>['basic','magic','baby'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); room.nursery.push(v); room.log.push(`${actor.name} renvoie ${v.name} à la Nurserie.`); } }
    if(card.effect==='all_discard1'){ room.players.filter(p=>p.id!==actor.id).forEach(p=>{ if(p.hand.length>0){ const d=p.hand.splice(Math.floor(Math.random()*p.hand.length),1)[0]; room.discard.push(d); room.log.push(`${p.name} défausse ${d.name}.`); } }); }
  }
  return true;
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

  socket.on('action', ({ type, cardId, targetPlayerId, discardIds }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms[roomId];
    if(!room || !room.started || room.winner !== null) return;
    const cp = room.players[room.currentPlayer];
    const actor = room.players.find(p=>p.id===playerId);
    if(!actor) return;

    // Huuue !! — annule une carte jouée depuis la main
    if(type === 'nope') {
      if(!room.pendingCard || room.phase !== 'reaction') return;
      // Licorne Protectrice : Illico ne peut pas être joué contre elle
      const pendingActor = room.players.find(p=>p.id===room.pendingCard.actorId);
      if(pendingActor && pendingActor.upgrades.some(u=>u.effect==='protection') && actor.id!==pendingActor.id) {
        return;
      }
      const cardIdx = actor.hand.findIndex(c=>c.id===cardId && c.effect==='nope');
      if(cardIdx === -1) return;
      const nopeCard = actor.hand.splice(cardIdx, 1)[0];
      const cancelled = room.pendingCard.card;
      room.discard.push(nopeCard, cancelled);
      room.lastCard = nopeCard;
      room.pendingCard = null;
      room.log.push(`🙅 ${actor.name} joue Huuue !! et annule ${cancelled.name} !`);
      room.phase = 'end';
      broadcast(room);
      return;
    }

    // Youpi !! — annule un Huuue !! (ici on l'utilise comme instant normal)
    if(type === 'play_instant') {
      const cardIdx = actor.hand.findIndex(c=>c.id===cardId && c.type==='instant');
      if(cardIdx === -1) return;
      const card = actor.hand.splice(cardIdx, 1)[0];
      room.discard.push(card);
      room.lastCard = card;
      room.log.push(`⚡ ${actor.name} joue ${card.name} !`);
      io.to(roomId).emit('instant_played', { playerName: actor.name, cardName: card.name });
      broadcast(room);
      return;
    }

    // Résoudre la carte en attente
    if(type === 'resolve') {
      if(cp.id !== playerId || !room.pendingCard || room.phase !== 'reaction') return;
      const { card, actorId, targetId } = room.pendingCard;
      const cardActor = room.players.find(p=>p.id===actorId);
      const cardTarget = room.players.find(p=>p.id===targetId) || cardActor;
      room.pendingCard = null;
      const applied = applyCardEffect(room, card, cardActor, cardTarget);
      if(!applied) { room.phase = 'action'; broadcast(room); return; }
      const w = checkWin(room);
      if(w !== null){ room.winner=w; room.log.push(`🏆 ${room.players[w].name} a gagné !`); broadcast(room); return; }
      room.phase = 'end';
      broadcast(room);
      return;
    }

    // À partir d'ici, seul le joueur courant peut agir
    if(cp.id !== playerId) return;

    // Phase début de tour
    if(type === 'skip_begin') {
      if(room.phase !== 'begin_of_turn') return;
      const hasSkip = cp.attacks.some(d=>d.effect==='skip_draw');
      if(hasSkip) {
        room.log.push(`${cp.name} ne peut pas piocher (Mauvais Sort).`);
        room.phase = 'action';
      } else {
        room.phase = 'draw';
      }
      broadcast(room); return;
    }

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
        if(room.nursery.length > 0) {
          const baby = room.nursery.shift();
          cp.stable.push(baby);
          room.log.push(`${cp.name} active Miroir des Âmes : défausse 2 cartes, amène ${baby.name} !`);
        } else {
          room.log.push(`${cp.name} active Miroir des Âmes : Nurserie vide.`);
        }
        room.usedBeginEffects.push(cardId);
        broadcast(room); return;
      }

      if(upgradeCard.effect === 'draw_when_attacked') {
        // Glitter Bomb : détruire 1 carte d'une autre écurie
        const t = room.players.find(p=>p.id===targetPlayerId);
        if(!t || t.id===cp.id) return;
        const allCards = [...t.stable, ...t.upgrades, ...t.attacks];
        if(allCards.length === 0) return;
        // On détruit la première carte non-bébé
        const toDestroy = allCards.find(c=>c.type!=='baby') || allCards[0];
        if(t.stable.some(c=>c.id===toDestroy.id)) t.stable=t.stable.filter(c=>c.id!==toDestroy.id);
        else if(t.upgrades.some(c=>c.id===toDestroy.id)) t.upgrades=t.upgrades.filter(c=>c.id!==toDestroy.id);
        else if(t.attacks.some(c=>c.id===toDestroy.id)) t.attacks=t.attacks.filter(c=>c.id!==toDestroy.id);
        room.discard.push(toDestroy);
        room.usedBeginEffects.push(cardId);
        room.log.push(`${cp.name} active Glitter Bomb : détruit ${toDestroy.name} de ${t.name}.`);
        broadcast(room); return;
      }
      return;
    }

    // Phase pioche
    if(type === 'draw') {
      if(room.phase !== 'draw') return;
      if(room.deck.length > 0) { cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche une carte.`); }
      room.phase = 'action';
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

      if(card.type === 'instant') {
        room.discard.push(card);
        room.log.push(`${cp.name} joue ${card.name}.`);
        broadcast(room); return;
      }

      room.pendingCard = { card, actorId: cp.id, targetId: target.id };
      room.phase = 'reaction';
      room.log.push(`${cp.name} joue ${card.name}... Huuue !! possible.`);
      broadcast(room); return;
    }

    // Phase fin de tour
    if(type === 'endturn') {
      if(room.phase !== 'end') return;
      // Limite de main : 7 par défaut, 5 si Ralentissement
      const limit = cp.attacks.some(d=>d.effect==='hand_limit_5') ? 5 : 7;
      while(cp.hand.length > limit) { room.discard.push(cp.hand.pop()); }
      room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
      room.phase = 'begin_of_turn';
      room.usedBeginEffects = [];
      room.pendingCard = null;
      room.log.push(`--- Tour de ${room.players[room.currentPlayer].name} ---`);
      broadcast(room); return;
    }
  });

  socket.on('disconnect', () => {
    const { roomId } = socket.data || {};
    if(roomId && rooms[roomId]) {
      rooms[roomId].players = rooms[roomId].players.filter(p=>p.socketId!==socket.id);
      if(rooms[roomId].players.length===0) delete rooms[roomId];
    }
  });
});

server.listen(3000, () => console.log('🦄 Serveur lancé sur port 3000'));
