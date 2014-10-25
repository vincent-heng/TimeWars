var express = require('express');
var http = require('http');
var fs = require('fs');
var app = express();
var server = require('http').createServer(app);
var io = require('socket.io').listen(server);
var ent = require('ent'); // équivalent de htmlentities
var EventEmitter = require('events').EventEmitter;
var url = require('url');
var querystring = require('querystring');
var colors = require('colors');
var path = require('path');

/* Game Constants */
var lifeTime = 100; // Amount of life at spawn
var nbCells = 49; // 7x7
var decreasingLifeFrequency = 4; // in seconds. Each (decreasingLifeFrequency) seconds, players lost 1 HP.

/* Game variables */
var nbJoueurs = 0;
var joueurs = {};


/*TEST ONLY : Some monsters

joueurs[2] =
{
	pseudo: "Scarabeille",
	life: lifeTime*3,
	nature: "MONSTER",
	score: 10
};


joueurs[24] =
{
	pseudo: "Testifox",
	life: lifeTime*5,
	nature: "MONSTER",
	score: 10
};

joueurs[44] =
{
	pseudo: "Babyfox",
	life: lifeTime/2,
	nature: "MONSTER",
	score: 10
};

*/



colors.setTheme({
  silly: 'rainbow',
  input: 'grey',
  verbose: 'cyan',
  prompt: 'grey',
  info: 'green',
  data: 'grey',
  help: 'cyan',
  warn: 'yellow',
  debug: 'blue',
  error: 'red'
});


console.log("Starting the server...".info);


// Load the main page
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

// Load CSS
app.get('/design/style.css', function (req, res) {
  res.sendfile(__dirname + '/design/style.css');
});

// Load socket.io
app.get('/socket.io/socket.io.js', function (req, res) {
  res.sendfile(__dirname + '/socket.io/socket.io.js');
});







// Player connection
io.sockets.on('connection', function (socket) {
    /*console.log('New Client Connection'); DEBUG */
	
	/* Player's connection :
	Event for the other players ( log + position on the map )
	Save in the server, ID, nickname, life, and score
	Event for the new player
	*/
	socket.on('player_authentication', function (chosenNickname) {

		if(chosenNickname == null)
		{
			chosenNickname = "Anonymous";
		}

		chosenNickname = ent.encode(chosenNickname);
	
		if(chosenNickname.length==0)
		{
			chosenNickname="Anonymous";
		}
		else if(chosenNickname.length > 14 )
		{
			chosenNickname = chosenNickname.substring(0,14);
		}
		
		console.log('Player Authentication : ' + chosenNickname);
		
		
		var i = 0;
		while(i < nbCells && (joueurs[i]!=undefined))
		{
			i++;
		}
		
		joueurs[i] =
		{
			pseudo: chosenNickname,
			life: lifeTime,
			nature: "PLAYER",
			score: 0
		};
		
		/*
		console.log("Current situation : ".debug);
		console.log(joueurs);
		*/
		
		
		nbJoueurs++;
		console.log(('Current number of players : ' + nbJoueurs).data);
		
		
		
		// Event for the new player
		socket.cellule = i;
		socket.pseudo = chosenNickname;
		socket.emit('message', "Welcome to the Arena, "+chosenNickname+".");
		socket.emit('player_created', {
			cellule: i,
			moi: joueurs[i]
		});
		
		socket.emit('load_map',joueurs); 
		
		
		
		// Event for the other players ( log + position on the map )
		socket.broadcast.emit('new_ennemi',{
			cellule: i,
			ennemi: joueurs[i]
		});
		
		// Setting the Life Timer
		socket.timer = setInterval(function(){
			if(joueurs[i]!=undefined)
			{
				joueurs[i].life--;
				socket.emit('refresh_ennemi',{
					cellule: i,
					ennemi: joueurs[i]
				});	
				
				socket.broadcast.emit('refresh_ennemi',{
					cellule: i,
					ennemi: joueurs[i]
				});
				
				joueurs[i].score+= 1;
				refresh_score();
				
				if(joueurs[i].life<=0)
				{
					player_death(i);
					clearInterval(socket.timer);
				}
			}
			else
			{
				clearInterval(socket.timer);
			}
		},decreasingLifeFrequency*1000);
	});		

	
	/* When a player shoots */
	socket.on('attack', function(target){
	
		// Is the target valid ?
		if(joueurs[target]==undefined)
		{
			socket.emit('message', "There is nothing to destroy in the cell "+target+".");
		}
		else if(target==socket.cellule)
		{
			socket.emit('message', " Shoot yourself ? That is not reasonnable !");
		}
		else if(joueurs[socket.cellule]==undefined)
		{
			socket.emit('message',"Too late. You are already dead.");
		}
		else if(joueurs[socket.cellule].life<=1)
		{
			socket.emit('message',"Not enough life to fight !");
		}
		else
		{
			
			var damage = parseInt(joueurs[socket.cellule].life/2);
			joueurs[target].life -= damage;
			joueurs[socket.cellule].life -= damage;
			
			joueurs[socket.cellule].score += 2;
			refresh_score();

			socket.emit('message', "Time-Missile bursts against "+joueurs[target].pseudo+" for "+damage+" plasma-year.");
			
			socket.broadcast.emit('get_hit',{
				cible:joueurs[target].pseudo, // pseudo
				agresseur:joueurs[socket.cellule].pseudo, // pseudo
				degats:damage
			});

			socket.emit('refresh_ennemi',{
				cellule: target,
				ennemi: joueurs[target]
			});

			socket.emit('refresh_ennemi',{
				cellule: socket.cellule,
				ennemi: joueurs[socket.cellule]
			});			
						
			socket.broadcast.emit('refresh_ennemi',{
				cellule: target,
				ennemi: joueurs[target]
			});

			socket.broadcast.emit('refresh_ennemi',{
				cellule: socket.cellule,
				ennemi: joueurs[socket.cellule]
			});
			
			console.log((joueurs[socket.cellule].pseudo+" hits "+ joueurs[target].pseudo+ " for "+ damage +" plasma-year.").info);
		
			if(joueurs[target].life <= 0) // Target dies
			{
				joueurs[target].life = 0;
				
				socket.emit('message',"You have eliminated "+joueurs[target].pseudo+".");
				player_death(target,socket.cellule);
				

				
				// augmenter le score
			}
			
			if(joueurs[socket.cellule].life <= 0) // The attacker dies ( actually impossible... but why not? )
			{
				joueurs[socket.cellule].life = 0;
				player_death(socket.cellule,target);
			}
			
		}
		
	});
	

	
	function player_death(cellule_victime,cellule_assassin)
	{

		if(cellule_assassin==undefined) // Natural death
		{
			socket.broadcast.emit('someone_died',{
			mort:joueurs[cellule_victime],
			position:cellule_victime
			}); // Warn everybody

			socket.emit('someone_died',{
			mort:joueurs[cellule_victime],
			position:cellule_victime
			}); // Warn the dead player

			
			console.log((joueurs[cellule_victime].pseudo + " died.").white);
		}
		else // Someone killed
		{
			socket.broadcast.emit('someone_killed',{
			mort:joueurs[cellule_victime],
			position:cellule_victime,
			pseudo_assassin:joueurs[cellule_assassin].pseudo
			});

			socket.emit('someone_killed',{
			mort:joueurs[cellule_victime],
			position:cellule_victime,
			pseudo_assassin:joueurs[cellule_assassin].pseudo
			});
			
			
			console.log((joueurs[cellule_victime].pseudo + " was killed by "+joueurs[cellule_assassin].pseudo+".").white);			
		}
		
		// On l'élimine de la liste
		joueurs[cellule_victime] = undefined;

		nbJoueurs--;
		console.log(('Current number of players : ' + nbJoueurs).data);
		
	}
	
	function refresh_score()
	{
	}
	
});

server.listen(8080);