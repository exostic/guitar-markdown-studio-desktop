# Guitar Markdown Studio

Éditeur de cours de guitare en deux colonnes : Markdown à gauche, rendu vectoriel à droite.

## Architecture

- `@gms/guitar-markdown` transforme les blocs spécialisés en AST.
- les tablatures et partitions sont gravées par [alphaTab](https://www.alphatab.net), à partir d'une traduction alphaTex générée par `@gms/guitar-markdown`.
- `@gms/renderer-svguitar` produit les diagrammes d'accords SVG.
- `apps/editor` fournit l'éditeur web Vite.
- `@gms/exporter-pdf` imprime le rendu avec Puppeteer.

Le texte Markdown reste la source de vérité. Le SVG n'est pas stocké dans les cours.

## Installation

```bash
npm install
npm run dev
```

Ouvrir ensuite l'adresse indiquée par Vite, généralement `http://localhost:5173`.

## Métadonnées (front matter)

```markdown
---
title: Amazing Grace
artist: Traditionnel
difficulty: Débutant
tempo: 70 BPM
time: 3/4
capo: 0
tuning: Standard
key: G
transpose: 0
sounding: false
sound: acoustic
logo: https://raw.githubusercontent.com/<user>/<repo>/main/assets/logo.png
logo-position: left
qr: false
---
```

- `title`, `artist` et les autres champs (`difficulty`, `tempo`, `time`, `capo`, `tuning`, …) s'affichent en pastilles sous le titre.
- `logo` : remplace le logo par défaut de l'en-tête par une image externe (URL). Sans ce champ, aucun logo ne s'affiche.
- `logo-position` : `left` pour aligner le logo à gauche, sinon centré par défaut.
- `qr` : mettre `qr: false` pour masquer le QR code d'en-tête (par défaut affiché en mode Livre/Poster, absent en mode Web). Le QR pointe vers la version web du cours : lien complet quand il tient dans un QR, sinon un cadre « QR généré à l'impression » dans l'aperçu, et au moment d'imprimer ou d'exporter en PDF l'application demande le lien court du contenu tel qu'il est (même contenu, même alias : réimprimer ne crée rien) et insère le QR définitif. Un cours ouvert par `?src=` garde ce lien, déjà court.
- `key` : tonalité du morceau (`G`, `Em`, `F# minor`, `Sol majeur`). Sert à épeler correctement les accords transposés (bémols en Fa, dièses en Sol…).
- `transpose` : `+2`, `-3`… décale tous les **noms d'accords** des blocs `chords`, `grid`, `song` et les annotations des tablatures. Les diagrammes de gamme, tableaux de tonalité et cercle des quintes ne sont jamais réécrits.
- `capo` + `sounding: true` : affiche entre parenthèses l'accord réellement entendu (« Am (Cm) » avec un capo en 3) sur les diagrammes d'accords et dans les grilles.
- `tuning` : `Standard`, `Drop D`, `DADGAD`, `Open G`, `Open D`, `Eb standard` ou une liste `D A D G B e`. Utilisé par les diagrammes de gamme, l'accordeur et la lecture audio.
- `sound` : instrument de la lecture audio — `acoustic` (défaut), `electric` (guitare électrique claire) ou `distortion` (électrique saturée). Les mots français fonctionnent aussi (`électrique`, `saturé`).
- `samples` : `off` pour jouer avec la corde synthétisée plutôt qu'avec les échantillons de guitare, chargés en arrière-plan (la synthèse reste utilisée tant qu'ils ne sont pas prêts). Le son `acoustic` vient d'une folk à cordes acier échantillonnée (« Acoustic Guitar » par Daindune, CC BY 3.0, mixée en mono, voir `apps/editor/public/samples/README.md`) ; l'électrique vient de la banque General MIDI livrée avec alphaTab.
- `soundfont` : URL d'une SoundFont (`.sf2`, non compressée) jouée en priorité, non affichée dans l'en-tête ; les banques de l'application complètent les programmes qu'elle n'a pas. Le fichier doit être servi avec CORS (le plus simple : à côté de l'application).
- `tempo` : cliquer sur la pastille lance un métronome (mode Web).

## Tablatures

````markdown
```tab
    Em              C
e|------0-------|------0-------|
B|----0---0-----|----1---1-----|
G|--0-------0---|--0-------0---|
D|--------------|2-------------|
A|2-------------|3-------------|
E|0-------------|--------------|
```
````

Le parser regroupe les notes placées à la même colonne en un seul événement. Chaque section séparée par `|` devient une mesure.

Techniques reconnues dans l'AST et dans le rendu :

```text
e|--5h7--7p5--5/7--7\5~--5t12--(5)--<12>--|
B|--------------8b10r8----8b---8br--------|
```

- `h` : hammer-on
- `p` : pull-off
- `t` : tapping
- `/` et `\` : slides
- `b` : bend — `8b10` monte jusqu'à la note écrite, `8b` seul monte d'un ton, `8br` monte puis redescend
- `r` : release d'un bend vers la note qui suit (`10r8`, `8b---r8`)
- `~` : vibrato
- `x` : note étouffée
- `(5)` : note fantôme (jouée doucement)
- `<12>` : harmonique naturelle

La lecture audio suit ces techniques : les slides, bends et releases glissent la hauteur de la note sans la repincer, les hammer-on, pull-off et tapping jouent l'arrivée en legato, le vibrato fait onduler la note, les harmoniques sonnent comme une cloche.

Une ligne `sound: clean` (ou `acoustic`, `distortion`) dans un bloc `tab` ou `partition` remplace le `sound` du front matter pour ce bloc seulement, par exemple une intro claire dans un morceau saturé. De la même façon, `tempo: 120`, `time: 3/4`, `tuning: Drop D` et `capo: 2` en tête d'un bloc lui donnent ses propres réglages de lecture et de gravure, utile pour un morceau importé dans un document qui en a d'autres.

Un bloc peut contenir plusieurs groupes de six lignes (avec, au-dessus de chacun, sa ligne d'accords) : ils sont lus comme des mesures qui se suivent, ce qui permet d'écrire un morceau long sur des lignes courtes.

Le bloc `partition` accepte exactement la même syntaxe ASCII que `tab`, mais affiche une portée de notation musicale au lieu d'une tablature. Une ligne `staff: tab`, `staff: partition` ou `staff: tab et partition` en tête du bloc choisit ce qui est dessiné ; la même clé `staff` dans le front matter fixe le choix pour tout le document.

Les deux blocs sont gravés par [alphaTab](https://www.alphatab.net) : l'ASCII est traduit en alphaTex (rythme explicite, silences, liaisons, triolets, bends dessinés avec leur courbe, glissés, harmoniques). Le rythme est déduit de l'espacement des colonnes : chaque mesure est calée sur la grille la plus grossière où ses notes tombent juste (noires, croches, triolets de croches, doubles, triples) ; une ligne `grid: 8` en tête du bloc impose le nombre de cases par mesure (8 = croches en 4/4). Une mesure dont l'espacement ne correspond à aucune grille garde l'ordre de ses notes sur une grille fine. Écrivez les mesures avec un nombre de caractères multiple du découpage voulu (16 caractères = doubles-croches en 4/4) pour un rythme fidèle.

## Diagrammes d'accords

````markdown
```chords
Em 022000
C  x32010
G  320003
D  xx0232
```
````

Les six caractères représentent les cordes de la plus grave à la plus aiguë. `x` signifie corde muette et `0` corde à vide.

## Diagramme de gamme (manche)

````markdown
```scale
frets: 0-12
e: 0|3|[5,A]|8|10|12
B: 1|3|[5]|8|10
```
````

- `frets: min-max` : plage de frettes affichée (déduite automatiquement si absente).
- Une ligne par corde (`e`, `B`, `G`, `D`, `A`, `E`), notes séparées par `|`.
- `12` : frette simple. `12,A` : frette avec une étiquette (ex. le nom de la note). `[12]` ou `[12,A]` : frette surlignée.

### Gammes nommées et arpèges

Plutôt que de saisir chaque frette, on peut nommer la gamme : les notes sont calculées, la fondamentale est surlignée.

````markdown
```scale
scale: A minor pentatonic
position: 1
labels: notes
```
````

````markdown
```scale
arpeggio: Am7
frets: 3-8
```
````

- `scale: <note> <nom>` : noms acceptés (anglais ou français) : `major/majeure`, `minor/mineure`, `minor pentatonic/pentatonique mineure`, `major pentatonic`, `blues`, `major blues`, `harmonic minor`, `melodic minor`, `dorian/dorien`, `phrygian`, `lydian`, `mixolydian`, `locrian`, `chromatic`, `whole tone`.
- `arpeggio: <accord>` : notes de l'accord sur le manche, colorées par degré (fondamentale, tierce, quinte, septième). Exclusif avec `scale:`.
- `position: 1…` : fenêtre de 5 cases qui débute sur la n-ième note de la gamme trouvée sur la corde grave (la position 1 démarre sur la fondamentale la plus basse). `frets:` a priorité si les deux sont présents.
- `labels: notes | degrees | none` : étiquette dans les pastilles (par défaut `notes` pour une gamme, `degrees` pour un arpège).
- `tuning:` : accordage propre au bloc, sinon celui du front matter.
- Les lignes de cordes explicites (`e: [8,bend]`) restent possibles et remplacent la note générée à la même case.
- Une légende sous le manche rappelle la gamme, la position et ses notes.

## Théorie

### Tonalité (`key`)

````markdown
```key G
```
````

````markdown
```key
key: F# minor
sevenths: true
```
````

Tableau des accords diatoniques (degré, chiffre romain, accord, notes, fonction), relative, armure, et pour les tonalités mineures la dominante du mineur harmonique. `sevenths: true` ajoute la colonne des accords de septième.

### Grille en chiffres romains

````markdown
```grid
key: G
||: I | V | vi | IV :|| x2
| ii7 | V7 | I | I |
```
````

Avec une ligne `key:`, les cellules en chiffres romains (`I ii iii IV V vi vii°`, `bVII`, `V7`, `IVmaj7`…) affichent l'accord correspondant avec le chiffre en petit dessous. Accords en clair et chiffres peuvent se mélanger. `/` conserve son sens de mesure coupée en deux.

### Cercle des quintes (`circle`)

````markdown
```circle D
```
````

Roue des tonalités majeures (extérieur) et de leurs relatives mineures (intérieur). La tonalité indiquée est mise en couleur avec ses voisines (sous-dominante, dominante) et leurs relatives. Sans argument, le cercle est affiché neutre.

### Accordeur (`tuner`)

````markdown
```tuner
tuning: DADGAD
```
````

En mode Web, six boutons jouent chaque corde à vide, et **🎤 Accorder au micro** écoute la guitare : le panneau affiche la note entendue, l'écart en cents sur une aiguille, et indique la corde de l'accordage la plus proche avec la consigne (tendez / détendez / juste). Le navigateur demande l'accès au micro la première fois. À l'impression, un tableau corde / note / fréquence remplace le tout.

En mode Web, six boutons jouent la note de chaque corde à vide. En mode Livre/Poster (et dans l'export HTML), un tableau corde / note / fréquence. Sans ligne `tuning:`, l'accordage du front matter est utilisé.

## Pages légales

Les règles de confidentialité et les conditions d'utilisation sont servies à `/confidentialite/` et `/conditions/` (dossiers `apps/editor/public/confidentialite/` et `conditions/`) et liées depuis l'en-tête de l'application. Ce sont les adresses à indiquer dans l'écran de consentement OAuth de Google.

## Installer comme application (PWA)

Le site est une *Progressive Web App* : dans Chrome (ou Edge), l'icône d'installation apparaît dans la barre d'adresse, et le menu **Fichier ▾** propose **Installer l'application** dès que le navigateur le permet. L'application s'ouvre alors dans sa propre fenêtre, avec son icône dans le Dock, le menu Démarrer ou l'écran d'accueil (Android ; sur iOS, Safari › Partager › Sur l'écran d'accueil). Un service worker (`apps/editor/public/sw.js`) garde en cache la page, les scripts, la police de notation et les sons : l'application reste utilisable hors ligne pour écrire, lire et écouter un cours ; seuls Drive, le raccourcisseur et l'envoi d'e-mail demandent le réseau. Les pages sont toujours demandées au réseau en premier, une mise à jour est donc prise en compte à la visite suivante. Le manifeste est `apps/editor/public/manifest.webmanifest`, les icônes `icon-192.png`, `icon-512.png`, `icon-512-maskable.png` et `apple-touch-icon.png` sont rendues depuis `favicon.svg`.

## Google Drive

Le menu **Fichier ▾** ouvre un cours depuis Google Drive, l'enregistre (sur le même fichier) ou l'enregistre sous un autre nom. Le menu **Partager ▾** propose **Copier un lien de partage** (le lien court, voir plus bas, ou le lien complet si le raccourcissement échoue), **Partager sur Drive avec…** : adresse d'un autre compte Google, lecture ou modification, et Drive envoie l'invitation (le destinataire ouvre le fichier depuis son Drive avec clic droit › **Ouvrir avec** › Guitar Markdown Studio, voir ci-dessous ; il apparaît ensuite dans sa liste « Ouvrir (Drive) »). **Envoyer par e-mail…** ouvre la messagerie (dans un nouvel onglet) sur un message d'accompagnement avec un lien court vers le cours. Copier un lien comme envoyer un e-mail demandent d'abord un mot de passe (**Sans mot de passe** ou **Protéger**) : avec un mot de passe, le cours est chiffré dans le lien, AES-256-GCM avec une clé dérivée du mot de passe par PBKDF2, le tout dans le navigateur ; le lien porte `#enc=` au lieu de `#doc=`, le raccourcisseur et le message ne voient que du chiffré, et le destinataire saisit le mot de passe à l'ouverture ; le message envoyé par e-mail l'inclut, un lien copié se transmet avec le mot de passe par vos soins ; le dernier mot de passe saisi est proposé à nouveau pendant la session. Le QR code imprimé en en-tête n'est jamais protégé. Le lien de partage : le lien de partage (qui contient le cours compressé) est raccourci en alias par TinyURL, sans clé ni compte, pour que le message reste léger et passe la limite de taille des messageries (Gmail refuse un `mailto:` au-delà d'environ 8 Ko). Le lien de partage est donc confié à TinyURL, qui le conserve ; si le raccourcissement échoue (hors ligne), le lien complet est envoyé quand il tient, sinon le Markdown est copié dans le presse-papiers et le message demande de le coller. Tout se passe côté client, avec OAuth seulement : il n'y a ni clé API ni secret dans l'application, seulement l'identifiant client OAuth, qui est public et déjà renseigné. Pour utiliser un autre projet Google, saisissez son identifiant dans **Réglages Google…** :

1. Dans la [console Google Cloud](https://console.cloud.google.com/apis/credentials), créez un projet, activez l'**API Google Drive**, et configurez l'écran de consentement OAuth (type externe, en mode test, avec votre adresse Google comme testeur).
2. Créez un identifiant OAuth de type **Application Web** avec, en origine JavaScript autorisée, l'adresse du site (et `http://localhost:5173` pour le développement), et en URI de redirection autorisée `http://localhost:43110/` pour l'application de bureau. Copiez l'identifiant client dans les réglages.

Sur le web, la connexion passe par la fenêtre Google dans la page ; dans l'application de bureau, par le navigateur du système, qui renvoie le jeton à l'application sur `localhost:43110`. Le jeton vaut une heure et n'est gardé qu'en mémoire. L'application ne demande que les portées `drive.file` et `drive.install`, non sensibles : elle voit et modifie uniquement les fichiers qu'elle a créés ou enregistrés elle-même, ou qu'on lui a demandé d'ouvrir depuis Drive, ce qui évite l'écran « Google n'a pas validé cette application » et toute procédure de validation. Un cours écrit ailleurs s'importe une fois (Fichier › Importer…) puis s'enregistre sur Drive ; il reste ensuite visible dans « Ouvrir depuis Drive ». L'identifiant peut aussi être fourni au build par `VITE_GOOGLE_CLIENT_ID`.

**Ouvrir avec, depuis Drive.** Un fichier partagé par quelqu'un d'autre n'est pas visible par l'application tant que son propriétaire ne l'a pas ouvert avec elle (c'est la règle de `drive.file`, l'autorisation vaut par utilisateur et par fichier). Le menu **Ouvrir avec** de Drive règle cela : Drive appelle l'application avec `?state={"ids":["<id>"],"action":"open"}` et lui accorde l'accès au fichier ; l'application demande alors la connexion Google, lit le cours, et le fichier apparaît ensuite dans « Ouvrir (Drive) ». Si l'utilisateur peut modifier le fichier, « Enregistrer (Drive) » l'écrit en place ; sinon il est ouvert en lecture seule et « Enregistrer sous… » crée sa copie. Pour que l'application figure dans ce menu, dans la console Google Cloud, page de l'**API Google Drive**, onglet **Intégration à l'interface utilisateur Drive** : nom et icônes de l'application, **URL d'ouverture** `https://gms.exostic.com/`, **types MIME par défaut** `text/markdown` et `text/plain`, **extensions de fichier par défaut** `md` ; l'entrée apparaît dans le menu des utilisateurs qui ont autorisé l'application (portée `drive.install`).

## Liens courts : votre propre service (Cloud Run)

Par défaut, les liens de partage sont raccourcis par TinyURL, qui conserve donc le lien (et le cours qu'il contient) sans limite de durée. Le dossier `services/shortlink` est un remplaçant minuscule à héberger sur Google Cloud Run avec Firestore, dans les quotas gratuits (2 millions de requêtes et 360 000 Go·s par mois pour Cloud Run, 1 Go et 50 000 lectures par jour pour Firestore ; un compte de facturation doit être rattaché au projet, mais rien n'est facturé sous ces seuils). Le service ne raccourcit que les liens de l'application (pas de redirection ouverte), calcule l'alias à partir du lien (même lien, même alias), accepte des liens jusqu'à 1 million de caractères (limite d'un document Firestore) et limite les demandes par adresse.

```
POST /api/links   {"url": "https://gms.exostic.com/?doc=…"}   →  {"url": "https://l.exostic.com/Ab3dEf9"}
GET  /Ab3dEf9                                                →  302 vers le lien (au-delà de 4 000 caractères : une page qui l'ouvre,
                                                                le frontal de Google supprimant un en-tête Location trop long)
```

Déploiement, depuis le dossier du dépôt, avec le [SDK gcloud](https://cloud.google.com/sdk/docs/install) et le projet Google Cloud déjà utilisé pour OAuth :

```sh
gcloud config set project <id-du-projet>
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com
gcloud firestore databases create --location=eur3          # une fois, base « (default) » en mode natif
gcloud run deploy gms-shortlink --source services/shortlink --region europe-west1 --allow-unauthenticated \
  --set-env-vars ALLOWED_ORIGINS=https://gms.exostic.com,PUBLIC_BASE_URL=https://l.exostic.com
```

`gcloud run deploy` affiche l'URL du service (`https://gms-shortlink-….run.app`). Le service de gms.exostic.com est déployé ainsi dans le projet de l'identifiant OAuth, région `europe-west1`, base Firestore `eur3`, et répond sur `https://l.exostic.com` (les liens courts ressemblent à `https://l.exostic.com/6MKjF9K`), adresse transmise au build par la variable GitHub `SHORTLINK_API`. Pour des liens courts sur votre domaine, mappez un sous-domaine : `gcloud beta run domain-mappings create --service gms-shortlink --domain l.exostic.com --region europe-west1`, puis créez chez votre registrar l'enregistrement DNS indiqué (CNAME vers `ghs.googlehosted.com`) ; le certificat HTTPS est émis par Google dans les heures qui suivent. Sans domaine propre, mettez l'URL `run.app` dans `PUBLIC_BASE_URL`.

Ensuite, indiquez l'adresse du service à l'application : soit dans **Fichier › Réglages Google…**, champ *Service de liens courts* (réglage local au navigateur), soit pour tout le monde au build, par la variable `VITE_SHORTLINK_API` (dans GitHub, *Settings › Secrets and variables › Actions › Variables*, créez `SHORTLINK_API` avec l'adresse : le workflow Pages la transmet). Si le service ne répond pas, l'application retombe sur TinyURL.

En local : `cd services/shortlink && STORE=memory npm start` (port 8080, sans Firestore) et `npm test`.

## Importer un fichier Guitar Pro

Le bouton **Importer** (ou **Ouvrir** sur le bureau) accepte aussi un fichier Guitar Pro (`.gp3`, `.gp4`, `.gp5`, `.gpx`, `.gp`). Le fichier est lu par alphaTab puis traduit et **ajouté en fin de document**, sous un titre au nom du morceau, sans toucher à ce qui est déjà écrit : chaque piste à six cordes devient un bloc `tab` avec `staff: tab et partition`, les mesures réparties sur des lignes d'au plus quatre mesures et une centaine de caractères, et ses propres lignes `tempo:`, `time:`, `tuning:`, `capo:` et `sound:`, pour se jouer et se graver comme dans le fichier. Un éditeur vide reçoit à la place un document complet, avec le front matter tiré du fichier.

Le composant **Guitar Pro** du menu **+** fait la même traduction mais insère les blocs à l'emplacement du curseur, sans titre ni note.

Le rythme est écrit dans l'espacement des colonnes (cases égales par mesure), les techniques deviennent la notation ASCII (`h`, `p`, `/`, `\\`, `b`, `br`, `~`, `(n)`, `<n>`, `x`) et les noms d'accords sont repris au-dessus des mesures. Quand le fichier contient plusieurs pistes utilisables, une fenêtre demande lesquelles importer (instrument, nombre de mesures et de notes à l'appui). Les pistes de basse ou de percussions, les changements de mesure en cours de morceau et les voix secondaires ne sont pas repris : une remarque en tête des blocs le signale.

## Lecture audio (mode Web)

En mode Web, un bouton **▶ Écouter** apparaît au-dessus des blocs `tab`, `partition`, `chords`, `grid` et `rhythm` :

- tablature / partition : chaque note est jouée par un échantillon de guitare (SoundFont) ou, à défaut, une corde pincée synthétisée (Karplus-Strong, une couleur par corde, caisse de résonance et pièce synthétisées), accords égrenés et jeu légèrement humanisé, au tempo du front matter, la mesure en cours est encadrée, la note (ou l'accord) en cours passe en rose sur la portée et la tablature, et un curseur vertical glisse d'une note à la suivante (il s'immobilise en pause) ; un clic sur une note la joue seule, y place le curseur de lecture, et sélectionne la note correspondante dans le Markdown (l'éditeur défile jusqu'à elle) ; **▶ Écouter** repart de ce curseur (il s'efface quand la lecture atteint la fin du bloc) ; pendant la lecture, l'aperçu suit la note en cours (l'éditeur, lui, ne bouge pas) ; la touche **Espace** met en pause, reprend, ou relance le dernier bloc écouté quand le focus n'est pas dans un champ de texte ;
- accords : chaque diagramme est gratté tour à tour (un clic sur un diagramme le gratte seul) ;
- grille : un accord par mesure (reprises et `xN` respectés, chiffres romains résolus dans la tonalité), et un clic sur une case joue son accord ;
- cercle des quintes : un clic sur un secteur (majeur ou mineur) joue l'accord correspondant ;
- gamme / arpège : un clic sur une note du manche la fait sonner, dans l'accordage du diagramme ;
- paroles (`song`) : un clic sur un accord écrit au-dessus des paroles le joue ;
- rythmique : la frappe en boucle avec le métronome, la frappe en cours est surlignée.

Le tempo vient de `tempo` (BPM = noires, 80 par défaut), la mesure de `time` (une mesure à 6/8 compte 3 noires), l'accordage de `tuning`, et `capo` décale la hauteur. Le sélecteur de vitesse à côté de chaque bouton (25 %, 50 %, 65 %, 80 %, 100 %) ralentit la lecture de ce bloc pour travailler un passage ; chaque bloc a sa propre vitesse, et un bloc en cours de lecture repart à la nouvelle vitesse. Le métronome de la pastille `tempo` garde le tempo écrit. Rien de tout cela n'apparaît à l'impression ni dans l'export HTML, qui ne contient pas de JavaScript.

## Autres blocs

### Rythmique

````markdown
```rhythm
B H | B h | H B | h B
```
````

Chaque temps séparé par `|` regroupe des frappes : `B` (bas), `H` (haut), minuscule = frappe fantôme, `-` = silence (le temps est compté mais rien n'est joué).

### Grille d'accords

````markdown
```grid
| Em | C | G/B | D |
```
````

Une cellule au format `Accord/Basse` (ex. `G/B`) s'affiche coupée en diagonale, accord en haut, note de basse en bas.

### Paroles et accords

````markdown
```song
[Em]Texte avec les [C]accords
```
````

Deux syntaxes sont acceptées, y compris mélangées dans le même bloc :

- **Accords en ligne**, juste avant la syllabe : `[Em]Texte avec les [C]accords`.
- **Accords sur leur propre ligne**, alignés en colonne au-dessus des paroles :

  ````markdown
  ```song
  Bm                         F#7
  On a dark desert highway   Cool wind in my hair
  ```
  ````

  Chaque accord est automatiquement rattaché au mot des paroles le plus proche de sa position.

Une ligne vide sépare les couplets. Une ligne `---` seule sépare les colonnes.

## Mise en page

Blocs sans contenu, à utiliser seuls sur leur propre ligne :

- ` ```pagebreak ``` ` : saut de page.
- ` ```columnbreak ``` ` : saut de colonne (dans une mise en page à colonnes).
- ` ```landscapebreak ``` ` : saut de page en mode Poster (le bouton « Saut de page (Poster) » du menu +). Sans `columnbreak` dans le document, le mode Poster répartit le contenu de lui-même : chaque bloc (titre, paragraphe, tablature, grille…) reste entier, les colonnes se remplissent dans l'ordre jusqu'à la hauteur de la page A4 paysage (réduites de 15 % au plus, un peu plus si une colonne resterait presque vide), un titre n'est jamais seul en bas de colonne, une page est pleine après trois colonnes (`poster-columns: 2`, de 1 à 4, dans le front matter change ce nombre) et un `landscapebreak` la termine avant : la page suivante commence là, et la répartition reprend. Dès qu'un `columnbreak` est présent, la mise en page est entièrement manuelle : `landscapebreak` commence une page, `columnbreak` une colonne, chaque colonne est réduite pour tenir. Le mode Livre n'est pas concerné.
- ` ```columns ``` ` … ` ```column ``` ` … ` ```endcolumns ``` ` : ouvre une section à colonnes, `column` sépare chaque colonne, `endcolumns` referme la section.
- ` ```zoom 0.8 ``` ` … ` ```endzoom ``` ` : réduit (ou agrandit) l'échelle du contenu entre les deux marqueurs. Le facteur (`0.1` à `3`) est optionnel, `0.8` par défaut.

## Images, vidéos et audio

Les images et liens Markdown standards fonctionnent tels quels :

```markdown
![Description](https://exemple.com/photo.jpg)

[Voir la vidéo](https://youtu.be/XXXXXXXXXXX)
[Écouter](https://exemple.com/audio.mp3)
```

- En mode Web, un lien YouTube ou vers un fichier audio (`.mp3`, `.wav`, `.ogg`, …) s'affiche automatiquement avec un lecteur intégré au lieu d'un simple lien.
- En mode Livre/Poster (impression), chaque lien s'affiche à la place sous forme de QR code (utile pour scanner un lien depuis une page imprimée).

## Ouvrir un cours depuis un lien

L'éditeur web (https://gms.exostic.com/) accepte des paramètres d'URL :

- `?enc=<base64url>` : document chiffré par mot de passe (1 octet de version, sel 16 octets, IV 12 octets, AES-256-GCM du document compressé par lz-string ; clé PBKDF2-SHA-256, 150 000 itérations). Le mot de passe est demandé à l'ouverture.
- `?src=<url>` : charge un fichier `.md` distant (raw GitHub, Gist, tout hébergement statique public ; une URL `github.com/.../blob/...` est convertie automatiquement).
- `?b64=<base64>` : le document encodé en base64 (alphabet standard ou URL-safe), sans hébergement.
- `#doc=<lz-string>` (ou `?doc=` pour les anciens liens) : le format produit par **Copier un lien de partage** (`compressToEncodedURIComponent`). Le document est placé après le `#` : cette partie n'est jamais envoyée au serveur, ce qui contourne la limite de 8 Ko que GitHub Pages impose à la partie `?` (erreur 414 au-delà) ; seule la limite du navigateur reste (2 Mo dans Chrome). Les autres paramètres (`mode`, `view`, `edit`, `enc`…) sont lus indifféremment après `?` ou `#`.
- `mode=web|book|poster`, `view=only`, `edit=hide`, `print=hide` : mode d'affichage et boutons masqués.

## Agents IA

La référence complète de la syntaxe, rédigée pour être lue par un agent IA (ChatGPT, Claude, etc.), est servie sur https://gms.exostic.com/llms.txt (source : `apps/editor/public/llms.txt`). Ce fichier est aussi injecté dans `index.html` à la construction (plugin dans `apps/editor/vite.config.js`, section masquée par CSS) : un agent qui lit simplement https://gms.exostic.com/ sans exécuter JavaScript reçoit donc la référence complète dès la première requête. Il suffit de donner l'adresse du site à l'agent pour qu'il puisse écrire un cours (théorie ou apprentissage d'un morceau) et renvoyer un lien `?src=` ou `?b64=` qui l'ouvre directement dans l'éditeur. Pensez à mettre ce fichier à jour quand la syntaxe évolue.

## Construire et exporter un PDF

```bash
npm run build
npm run preview
```

Installer Puppeteer pour l’export automatisé :

```bash
npm install --save-dev puppeteer
```

Dans un autre terminal :

```bash
npm run export:pdf -- http://localhost:4173 ./cours.pdf
```

Le bouton **Imprimer / PDF** du navigateur fonctionne également.

## Tests

```bash
npm test
```

## Limites de cette première version

La partition (bloc `partition`) suppose toujours l'accordage standard pour placer les notes sur la portée, même si `tuning` est renseigné.

La durée musicale est actuellement déduite du nombre d'événements présents dans une mesure. La position horizontale de l'ASCII sert à regrouper les notes simultanées, mais ne représente pas encore une quantification rythmique exacte. Le prochain jalon consiste à ajouter une ligne de comptage ou une syntaxe explicite de durée.
