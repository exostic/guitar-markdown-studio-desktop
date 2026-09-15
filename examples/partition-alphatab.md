---
title: Partition gravée par alphaTab
artist: Document de démonstration
difficulty: Intermédiaire
tempo: 90 BPM
time: 4/4
key: C
tuning: Standard
sound: acoustic
---

> **Objectif :** voir comment un bloc `partition` écrit en ASCII est gravé par alphaTab. L'ASCII reste la source : il est traduit en alphaTex, avec un rythme déduit de l'espacement des colonnes.

## Écrire un rythme lisible

Chaque mesure est calée sur la grille la plus grossière où ses notes tombent juste. Une mesure de 16 caractères se lit en doubles-croches : une note tous les 4 caractères est une noire, tous les 2 une croche, tous les 3 une croche pointée.

```partition
e|3---5---7---8---|3-5-7-8-3-5-7-8-|3--5--7--8--0---|3--5-7-8--------|
B|----------------|----------------|----------------|----------------|
G|----------------|----------------|----------------|----------------|
D|----------------|----------------|----------------|----------------|
A|----------------|----------------|----------------|----------------|
E|----------------|----------------|----------------|----------------|
```

Un tiret devant la première note ne décale pas la grille, et une mesure qui commence plus tard reçoit un silence. Trois notes égales sur une mesure forment un triolet.

```partition
e|-3--5--7--8-|----0---|3--5--7--|--------|
B|------------|----1---|---------|--------|
G|------------|----0---|---------|--------|
D|------------|--------|---------|--------|
A|------------|--------|---------|--------|
E|------------|--------|---------|--------|
```

## Imposer la grille

Quand l'espacement est ambigu, une ligne `grid:` en tête du bloc fixe le nombre de cases par mesure : `grid: 4` pour des noires, `grid: 8` pour des croches en 4/4.

```partition
grid: 4
e|3-5-7-8---------|
B|----------------|
G|----------------|
D|----------------|
A|----------------|
E|----------------|
```

## Techniques

Hammer-on, pull-off et tap deviennent des liaisons annotées, les glissés des traits, les bends une courbe sur la note de départ (`8b10r8` est une seule note), le vibrato une ondulation, `(5)` une note fantôme, `<12>` une harmonique et `x` une note étouffée.

```partition
grid: 16
e|5h7-8p7-5t12x---|5/7-9\7~~(5)<12>|8b10r8--8b--8br-|----5-----------|
B|----------------|----------------|----------------|8b10--r8--------|
G|----------------|----------------|----------------|----------------|
D|----------------|----------------|----------------|----------------|
A|----------------|----------------|----------------|----------------|
E|----------------|----------------|----------------|----------------|
```

## Accords arpégés

Les notes empilées dans une colonne forment un accord, le nom au-dessus de la mesure est repris sur la portée. Les mesures font 16 caractères, une note tous les 2 : des croches. Ce bloc garde un son clair grâce à sa ligne `sound:`.

```partition
sound: clean
    C                Am               F                G
e|------0-------0-|------0-------0-|------1-------1-|------3-------3-|
B|----1---1---1---|----1---1---1---|----1---1---1---|----0---0---0---|
G|--0-------0-----|--2-------2-----|--2-------2-----|--0-------0-----|
D|2---------------|2---------------|3---------------|0---------------|
A|3---------------|0---------------|----------------|2---------------|
E|----------------|----------------|1---------------|3---------------|
```

## Tablature, portée, ou les deux

Une ligne `staff:` en tête du bloc choisit ce qu'alphaTab dessine : `tab`, `partition`, ou `tab et partition`. Sans cette ligne, c'est la clé `staff` du front matter qui décide, et sinon la portée seule.

```partition
staff: tab et partition
e|3---5---7---8---|3-5-7-8-3-5-7-8-|
B|----------------|----------------|
G|----------------|----------------|
D|----------------|----------------|
A|----------------|----------------|
E|----------------|----------------|
```

```partition
staff: tab
e|3--5-7-8--------|3--5--7--8--0---|
B|----------------|----------------|
G|----------------|----------------|
D|----------------|----------------|
A|----------------|----------------|
E|----------------|----------------|
```

## Le même bloc en `tab`

Un bloc `tab` est gravé de la même façon, tablature seule par défaut : la même mélodie qu'au début.

```tab
e|3---5---7---8---|3-5-7-8-3-5-7-8-|3--5--7--8--0---|3--5-7-8--------|
B|----------------|----------------|----------------|----------------|
G|----------------|----------------|----------------|----------------|
D|----------------|----------------|----------------|----------------|
A|----------------|----------------|----------------|----------------|
E|----------------|----------------|----------------|----------------|
```
