# Guitar Markdown Studio — VexFlow

Éditeur de cours de guitare en deux colonnes : Markdown à gauche, rendu vectoriel à droite.

## Architecture

- `@gms/guitar-markdown` transforme les blocs spécialisés en AST.
- `@gms/renderer-vexflow` produit les tablatures SVG.
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
logo: https://raw.githubusercontent.com/<user>/<repo>/main/assets/logo.png
logo-position: left
qr: false
---
```

- `title`, `artist` et les autres champs (`difficulty`, `tempo`, `time`, `capo`, `tuning`, …) s'affichent en pastilles sous le titre.
- `logo` : remplace le logo par défaut de l'en-tête par une image externe (URL). Sans ce champ, aucun logo ne s'affiche.
- `logo-position` : `left` pour aligner le logo à gauche, sinon centré par défaut.
- `qr` : mettre `qr: false` pour masquer le QR code d'en-tête (par défaut affiché en mode Livre/Poster, absent en mode Web).

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
e|--5h7--7p5--5/7--7\5~--|
B|--------------8b10------|
```

- `h` : hammer-on
- `p` : pull-off
- `/` et `\` : slides
- `b` : bend
- `~` : vibrato
- `x` : note étouffée

Le bloc `partition` accepte exactement la même syntaxe ASCII que `tab`, mais affiche une portée de notation musicale (VexFlow) au lieu d'une tablature.

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
- ` ```landscapebreak ``` ` : saut de page en orientation paysage.
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

La durée musicale est actuellement déduite du nombre d'événements présents dans une mesure. La position horizontale de l'ASCII sert à regrouper les notes simultanées, mais ne représente pas encore une quantification rythmique exacte. Le prochain jalon consiste à ajouter une ligne de comptage ou une syntaxe explicite de durée.
