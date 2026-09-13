export const DEFAULT_MARKDOWN = `---
title: Voyage en accords
logo: https://raw.githubusercontent.com/exostic/guitar-markdown-studio-desktop/main/assets/logo.png
artist: Morceau pédagogique original
difficulty: Débutant
tempo: 76 BPM
time: 4/4
capo: 0
tuning: Standard
---

> **Objectif :** travailler un arpège régulier, les changements d'accords et quelques techniques de liaison.

## Accords

\`\`\`zoom 0.7
\`\`\`

\`\`\`chords
Em 022000
C  x32010
G  320003
D  xx0232
\`\`\`

\`\`\`endzoom
\`\`\`

## Arpège principal

Écris la tablature en ASCII. Le rendu de droite est généré en SVG par VexFlow.

\`\`\`tab
    Em              C               G               D
e|------0-------|------0-------|------3-------|------2-------|
B|----0---0-----|----1---1-----|----0---0-----|----3---3-----|
G|--0-------0---|--0-------0---|--0-------0---|--2-------2---|
D|--------------|2-------------|0-------------|0-------------|
A|2-------------|3-------------|2-------------|--------------|
E|0-------------|--------------|3-------------|--------------|
\`\`\`

\`\`\`columnbreak
\`\`\`


\`\`\`pagebreak
\`\`\`


## Partition

Le même arpège, avec la portée de notation classique au-dessus de la tablature.

\`\`\`partition
    Em              C               G               D
e|------0-------|------0-------|------3-------|------2-------|
B|----0---0-----|----1---1-----|----0---0-----|----3---3-----|
G|--0-------0---|--0-------0---|--0-------0---|--2-------2---|
D|--------------|2-------------|0-------------|0-------------|
A|2-------------|3-------------|2-------------|--------------|
E|0-------------|--------------|3-------------|--------------|
\`\`\`

## Techniques

\`\`\`tab
e|--5h7--7p5------|--5/7--7\\5~-----|
B|-----------8b10-|------------------|
G|----------------|------------------|
D|----------------|------------------|
A|----------------|------------------|
E|----------------|------------------|
\`\`\`

## Illustration

Une image classique en markdown (\`![texte alternatif](url)\`) s'insère aussi bien dans le cours — utile pour une photo de position de main, un schéma, etc.

![Position de la main](https://placehold.co/640x360?text=Position+de+la+main)

## Rythmique

\`\`\`rhythm
B H | B h | B H | h B
\`\`\`

## Grille

\`\`\`grid
||: Em | C | G | D :|| x2
Em | C | G | D
\`\`\`

\`\`\`columnbreak
\`\`\`


\`\`\`pagebreak
\`\`\`


## Deux façons de jouer

Le bloc \`columns\` ... \`column\` ... \`endcolumns\` met en page n'importe quel contenu (titres, grilles, tablatures, texte...) en colonnes côte à côte, pour comparer par exemple deux versions d'une même progression.

\`\`\`columns
\`\`\`

### Version simple

\`\`\`grid
| Em | C | G | D |
\`\`\`

\`\`\`column
\`\`\`

### Version enrichie

\`\`\`grid
| Em7 | Cadd9 | G | Dsus4 |
\`\`\`

\`\`\`endcolumns
\`\`\`

## Paroles

Une fois les accords en place, essaie de les jouer en rythme sous ce petit couplet (paroles originales, écrites pour cet exercice). Une ligne de \`---\` seule dans le bloc démarre une nouvelle colonne (tu peux en ajouter autant que tu veux) :

\`\`\`song
[Em]Sur la route on chante une [C]mélodie légère,
Les [G]cordes vibrent au rythme de nos [D]pas,
[Em]Chaque accord est une [C]nouvelle lumière,
Le [G]voyage continue, on ne s'arrête [D]pas.

[Am]On reprend le [C]refrain [G]ensemble une fois de [D]plus,
Le [Em]son de la guitare ne s'arrête [C]jamais [G]plus,
[Em]Chaque nouvelle [C]ville a son propre [G]refrain,
On [D]apprend les accords, on [Em]trace le chemin.

---

[Em]Sur la route on chante une [C]dernière fois,
Le [G]voyage s'achève, mais la musique [D]reste en [Em]nous.
\`\`\`

## Exercice

1. Jouer chaque mesure à 60 BPM.
2. Monter progressivement jusqu'à 76 BPM.
3. Conserver un mouvement régulier de la main droite.

## Ressources

Retrouve la [vidéo de démonstration](https://www.youtube.com/watch?v=dQw4w9WgXcQ) de ce morceau. En mode Web, un lien YouTube s'affiche directement comme une vidéo intégrée ; en mode Livret ou Poster il devient un QR code à scanner.

Écoute aussi une [piste audio d'exemple](https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3) : un lien direct vers un fichier audio (.mp3, .wav...) s'affiche en mode Web comme un lecteur audio intégré.
`;
