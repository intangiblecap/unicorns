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
    for(let i=0;i<2;i++) cards.push({id:id++,name,type:'basic',desc:'Une licorne basique.'});
  });
  const magics = [
    {name:'Licorne Mystique',effect:'draw1',desc:'Quand elle entre : pioche 1 carte.'},
    {name:'Licorne Cupidon',effect:'nursery',desc:'Quand elle entre : prend un bébé de la pépinière.'},
    {name:'Licorne Ange',effect:'revive',desc:'Quand elle entre : récupère une carte de la défausse.'},
    {name:'Licorne Chaos',effect:'steal',desc:'Quand elle entre : vole une licorne adverse.'},
    {name:'Licorne Protectrice',effect:'protection',desc:'Les instants ne peuvent pas être joués contre toi.'},
  ];
  magics.forEach(c => cards.push({id:id++,...c,type:'magic'}));
  [
    {name:'Corne Magique',effect:'extra_point',desc:'+1 licorne pour la victoire.'},
    {name:'Glitter Bomb',effect:'draw_when_attacked',desc:'Pioche quand une de tes licornes est attaquée.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'upgrade'}); });
  [
    {name:'Mauvais Sort',effect:'skip_draw',desc:'Ce joueur ne peut pas piocher au début de son tour.'},
    {name:'Voleur de Corne',effect:'no_unicorn',desc:'Ce joueur ne peut pas amener de licorne.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'downgrade'}); });
  [
    {name:'Récolte Arc-en-ciel',effect:'draw2',desc:'Pioche 2 cartes.'},
    {name:'Destruction',effect:'destroy',desc:'Défausse une licorne d\'une écurie adverse.'},
    {name:'Vol de Corne',effect:'steal_spell',desc:'Vole une licorne d\'une écurie adverse.'},
    {name:'Retour Pépinière',effect:'return',desc:'Retourne une licorne à la pépinière.'},
    {name:'Tempête Magique',effect:'draw3',desc:'Pioche 3 cartes.'},
  ].forEach(c => { for(let i=0;i<2;i++) cards.push({id:id++,...c,type:'spell'}); });
  [
    {name:'Non !!',effect:'nope',desc:'Annule l\'effet d\'une carte adverse.'},
    {name:'Si !!',effect:'yep',desc:'Annule un Non !!'},
  ].forEach(c => { for(let i=0;i<3;i++) cards.push({id:id++,...c,type:'instant'}); });
  return shuffle(cards);
}

function buildNursery() {
  let id = 2000;
  const babies = ['Bébé Arc-en-ciel','Bébé Étoile','Bébé Nuage','Bébé Doré','Bébé Magique','Bébé Paillette'];
  const n = [];
  babies.forEach(name => { for(let i=0;i<3;i++) n.push({id:id++,name,type:'baby',desc:'Mignon et inoffensif.'}); });
  return shuffle(n);
}

function checkWin(room) {
  for(const p of room.players) {
    const unicorns = p.stable.filter(c=>['baby','basic','magic'].includes(c.type)).length;
    const bonus = p.upgrades.filter(c=>c.effect==='extra_point').length;
    if(unicorns + bonus >= 7) return p.id;
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
    p.downgrades = [];
  });
  room.deck = deck;
  room.nursery = nursery.slice(room.players.length);
  room.discard = [];
  room.currentPlayer = 0;
  room.phase = 'draw';
  room.lastCard = null;
  room.log = [`La partie commence ! Tour de ${room.players[0].name}`];
  room.started = true;
  room.winner = null;
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
      downgrades: p.downgrades,
      handCount: p.hand.length,
      isCurrentPlayer: room.currentPlayer === room.players.indexOf(p),
    })),
    currentPlayer: room.currentPlayer,
    phase: room.phase,
    lastCard: room.lastCard,
    deckCount: room.deck.length,
    log: room.log.slice(-15),
    winner: room.winner,
  };
}

function broadcast(room) {
  room.players.forEach(p => {
    io.to(p.socketId).emit('state', getState(room, p));
  });
}

io.on('connection', socket => {
  socket.on('join', ({ roomId, name }) => {
    if(!rooms[roomId]) {
      rooms[roomId] = { id: roomId, players: [], deck: [], nursery: [], discard: [], currentPlayer: 0, phase: 'draw', log: [], started: false, winner: null, lastCard: null };
    }
    const room = rooms[roomId];
    if(room.started) { socket.emit('error','Partie déjà commencée !'); return; }
    if(room.players.length >= 6) { socket.emit('error','Salle pleine !'); return; }
    const player = { id: room.players.length, socketId: socket.id, name, hand: [], stable: [], upgrades: [], downgrades: [] };
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

  socket.on('action', ({ type, cardId, targetPlayerId }) => {
    const { roomId, playerId } = socket.data || {};
    const room = rooms[roomId];
    if(!room || !room.started || room.winner !== null) return;
    const cp = room.players[room.currentPlayer];
    if(cp.id !== playerId) return;

    if(type === 'draw') {
      if(room.phase !== 'draw') return;
      const hasSkip = cp.downgrades.some(d=>d.effect==='skip_draw');
      if(!hasSkip && room.deck.length > 0) { cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche une carte.`); }
      else if(hasSkip) { room.log.push(`${cp.name} ne peut pas piocher (Mauvais Sort).`); }
      room.phase = 'action';
      broadcast(room); return;
    }

    if(type === 'skip') {
      if(room.phase !== 'action') return;
      room.phase = 'end';
      room.log.push(`${cp.name} passe son action.`);
      broadcast(room); return;
    }

    if(type === 'endturn') {
      if(room.phase !== 'end') return;
      while(cp.hand.length > 7) { room.discard.push(cp.hand.pop()); }
      room.currentPlayer = (room.currentPlayer + 1) % room.players.length;
      room.phase = 'draw';
      room.log.push(`--- Tour de ${room.players[room.currentPlayer].name} ---`);
      broadcast(room); return;
    }

    if(type === 'play') {
      if(room.phase !== 'action') return;
      const cardIdx = cp.hand.findIndex(c=>c.id===cardId);
      if(cardIdx === -1) return;
      const card = cp.hand.splice(cardIdx,1)[0];
      const target = room.players[targetPlayerId] || cp;
      room.lastCard = card;

      if(['basic','magic'].includes(card.type)) {
        if(cp.downgrades.some(d=>d.effect==='no_unicorn')) { cp.hand.push(card); room.log.push(`${cp.name} ne peut pas amener de licorne !`); broadcast(room); return; }
        cp.stable.push(card);
        room.log.push(`${cp.name} amène ${card.name} dans son écurie.`);
        if(card.effect==='draw1'&&room.deck.length>0){ cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche 1 carte.`); }
        if(card.effect==='nursery'&&room.nursery.length>0){ cp.stable.push(room.nursery.shift()); room.log.push(`${cp.name} prend un bébé licorne.`); }
        if(card.effect==='revive'&&room.discard.length>0){ cp.hand.push(room.discard.pop()); room.log.push(`${cp.name} récupère une carte de la défausse.`); }
        if(card.effect==='steal'){
          const victims = room.players.filter(p=>p.id!==cp.id&&p.stable.filter(c=>['basic','magic'].includes(c.type)).length>0);
          if(victims.length>0){ const v=victims[0]; const uni=v.stable.filter(c=>['basic','magic'].includes(c.type)); const stolen=uni[Math.floor(Math.random()*uni.length)]; v.stable=v.stable.filter(c=>c.id!==stolen.id); cp.stable.push(stolen); room.log.push(`${cp.name} vole ${stolen.name} à ${v.name}.`); }
        }
      } else if(card.type==='upgrade') {
        cp.upgrades.push(card);
        room.log.push(`${cp.name} joue ${card.name}.`);
      } else if(card.type==='downgrade') {
        target.downgrades.push(card);
        room.log.push(`${cp.name} joue ${card.name} sur ${target.name}.`);
      } else if(card.type==='spell') {
        room.discard.push(card);
        if(card.effect==='draw2'){ for(let i=0;i<2&&room.deck.length>0;i++) cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche 2 cartes.`); }
        if(card.effect==='draw3'){ for(let i=0;i<3&&room.deck.length>0;i++) cp.hand.push(room.deck.shift()); room.log.push(`${cp.name} pioche 3 cartes.`); }
        if(card.effect==='destroy'){ const u=target.stable.filter(c=>['basic','magic'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); room.discard.push(v); room.log.push(`${cp.name} détruit ${v.name} de ${target.name}.`); } }
        if(card.effect==='steal_spell'){ const u=target.stable.filter(c=>['basic','magic'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); cp.stable.push(v); room.log.push(`${cp.name} vole ${v.name} à ${target.name}.`); } }
        if(card.effect==='return'){ const u=target.stable.filter(c=>['basic','magic','baby'].includes(c.type)); if(u.length>0){ const v=u[0]; target.stable=target.stable.filter(c=>c.id!==v.id); room.nursery.push(v); room.log.push(`${cp.name} renvoie ${v.name} à la pépinière.`); } }
      }

      const w = checkWin(room);
      if(w !== null){ room.winner=w; room.log.push(`🏆 ${room.players[w].name} a gagné !`); broadcast(room); return; }
      room.phase = 'end';
      broadcast(room);
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
