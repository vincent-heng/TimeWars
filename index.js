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

var path = require('path');

/* Constantes de jeu */
var lifeTime = 20; // en secondes
var nbCellules = 25; // 5x5

/* Variables de jeu */
var nbJoueurs = 0;
var joueurs = {};

/*POUR LES TEST : des mobs de départ
joueurs[2] =
{
	pseudo: "Scarabeille",
	life: lifeTime,
	nature: "MONSTER",
	score: 10
};


joueurs[24] =
{
	pseudo: "Testifox",
	life: lifeTime,
	nature: "MONSTER",
	score: 10
};
*/



console.log("Starting the server...");


// Chargement de la page index.html
app.get('/', function (req, res) {
  res.sendfile(__dirname + '/index.html');
});

app.get('/design/style.css', function (req, res) {
  res.sendfile(__dirname + '/design/style.css');
});


// Quand un client se connecte, on établit une connexion sockets
io.sockets.on('connection', function (socket) {
    /*console.log('New Client Connection'); DEBUG */
	
	/* Un client choisit un pseudo, il devient joueur
	Il faut en avertir les autres ( log + position sur map )
	Il faut l'enregistrer chez nous, sous id, pseudo, points de vie.
	Il faut qu'il charge la position de tout le monde
	*/
	socket.on('player_authentication', function (pseudo_choisi) {

		if(pseudo_choisi == null)
		{
			pseudo_choisi = "Anonymous";
		}

		pseudo_choisi = ent.encode(pseudo_choisi);
	
		if(pseudo_choisi.length==0)
		{
			pseudo_choisi="Anonymous";
		}
		else if(pseudo_choisi.length > 17 )
		{
			pseudo_choisi = pseudo_choisi.substring(0,17);
		}
		
		console.log('Player Authentication : ' + pseudo_choisi);
		
		// Modele : 	joueurs[id][pseudo]
		// 				joueurs[id][life]
		
		var i = 0;
		while(i < nbCellules && (joueurs[i]!=undefined))
		{
			i++;
		}
		
		joueurs[i] =
		{
			pseudo: pseudo_choisi,
			life: lifeTime,
			nature: "PLAYER",
			score: 0
		};
		
		/* DEBUG 
		console.log("Etat actuel de la partie : ");
		console.log(joueurs);
		*/
		
		
		nbJoueurs++;
		console.log('Nombre de Joueurs actuel : ' + nbJoueurs);
		
		
		
		// Mise à jour du joueur
		socket.cellule = i;
		socket.pseudo = pseudo_choisi;
		socket.emit('message', "Bienvenue dans l'arène, "+pseudo_choisi+".");
		socket.emit('player_created', {
			cellule: i,
			moi: joueurs[i]
		});
		
		socket.emit('load_map',joueurs); 
		
		
		
		// Mise à jour des autres joueurs
		//socket.broadcast.emit('message', cellule, pseudo_choisi+" est entre dans l'arene.");
		socket.broadcast.emit('new_ennemi',{
			cellule: i,
			ennemi: joueurs[i]
		});
		
		// pour perdre 1 point de vie par seconde, utiliser setInterval(callback,delay,[arg]) Voir : nodejs.org/api/timers.html
		socket.timer = setInterval(function(){
			if(joueurs[i]!=undefined)
			{
				joueurs[i].life--; // On perd un point de vie par seconde
				socket.emit('refresh_ennemi',{
					cellule: i,
					ennemi: joueurs[i]
				});				
				
				socket.broadcast.emit('refresh_ennemi',{
					cellule: i,
					ennemi: joueurs[i]
				});
				
				// On gagne un point de score régulièrement
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
		},4000);
		// 					*/
	});		

	
	/* Le joueur attaque sa cible	
	Il faut vérifier la présence du joueur
	Il faut soustraire les points de vie aux deux joueurs
	Augmenter le score
	Déconnecter le mort
	Faire un retour à tout le monde
	*/
	socket.on('attack', function(target){
		if(joueurs[target]==undefined)
		{
			socket.emit('message', "Il n'y a rien à détruire dans la cellule "+target+".");
		}
		else if(target==socket.cellule)
		{
			socket.emit('message', "Se frapper soi-même ? Ce n'est pas raisonnable !");
		}
		else if(joueurs[socket.cellule]==undefined)
		{
			socket.emit('message',"Trop tard.");
		}
		else if(joueurs[socket.cellule].life<=1)
		{
			socket.emit('message',"Pas assez d'énergie !");
		}
		else
		{
			
			/* Algorithme d'attaque :
				La moitié de ses points de vie en dégâts
				On perd la moitié de ses points de vie
				On gagne des points
				Si ça tue la cible, on gagne encore plus de points
			*/
			
			var damage = parseInt(joueurs[socket.cellule].life/2);
			joueurs[target].life -= damage;
			joueurs[socket.cellule].life -= damage;
			
			joueurs[socket.cellule].score += 2;
			refresh_score();

			socket.emit('message', "Missile temporel sur "+joueurs[target].pseudo+" pour "+damage+" plasmannées.");
			
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
			
			console.log(joueurs[socket.cellule].pseudo+" hits "+ joueurs[target].pseudo+ " for "+ damage +" plasma-year.");
		
			if(joueurs[target].life <= 0) // La cible meurt
			{
				joueurs[target].life = 0;
				
				socket.emit('message',"Vous avez assassiné le seigneur "+joueurs[target].pseudo+".");
				player_death(target,socket.cellule);
				

				
				// augmenter le score
			}
			
			if(joueurs[socket.cellule].life <= 0) // L'attaquant meurt ( normalement, impossible )
			{
				joueurs[socket.cellule].life = 0;
				player_death(socket.cellule,target);
			}
		
		/* DEBUG
		console.log("Etat actuel de la partie : ");
		console.log(joueurs);
		*/
			
		}
		
	});
	
	
	
	
	
	// Déconnexion d'un client
	socket.on('disconnect',function(){
		/*console.log("Client Disconnection"); DEBUG */
	});
	
	/* Un joueur meurt
	Il faut en avertir les autres ( log + position sur map )
	Il faut l'éliminer de la liste des joueurs
	*/

	function player_death(cellule_victime,cellule_assassin)
	{
		// Gestion du tableau des scores plus tard
		


		if(cellule_assassin==undefined)
		{
			socket.broadcast.emit('someone_died',{
			mort:joueurs[cellule_victime],
			position:cellule_victime
			}); // On envoie les infos à tout le monde

			socket.emit('someone_died',{
			mort:joueurs[cellule_victime],
			position:cellule_victime
			}); // On envoie les infos au mort

			
			console.log(joueurs[cellule_victime].pseudo + " est mort.");
		}
		else
		{
			socket.broadcast.emit('someone_killed',{
			mort:joueurs[cellule_victime],
			position:cellule_victime,
			pseudo_assassin:joueurs[cellule_assassin].pseudo
			}); // On envoie les infos du mort au mort, qui se reconnaîtra	

			socket.emit('someone_killed',{
			mort:joueurs[cellule_victime],
			position:cellule_victime,
			pseudo_assassin:joueurs[cellule_assassin].pseudo
			}); // On envoie les infos du mort à l'assassin
			
			
			console.log(joueurs[cellule_victime].pseudo + " s'est fait assassiner par "+joueurs[cellule_assassin].pseudo+".");			
		}
		
		// On l'élimine de la liste
		joueurs[cellule_victime] = undefined;

		nbJoueurs--;
		console.log("Nombre de Joueurs actuel : "+nbJoueurs);
		
	}
	
	function refresh_score()
	{
	}
	
});

server.listen(8080);