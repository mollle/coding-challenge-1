# README.md

Es fehlt eine Dokumentation zum Setup des Repos. Es wird zwar auf ein Docker-Kommando verwiesen, aber es wäre gut zu wissen, was genau benötigt wird. Ich habe zum Beispiel schon eine DB auf 5432 laufen und habe dementsprechend Probleme gehabt beim Setup. Da musste ich erstmal nachvollziehen, was genau im Hintergrund passiert. Viele vernachlässigen dies. Ich denke, es ist jedoch von entscheidender Bedeutung um die DX zu verbessern. Du kannst viele glücklich machen, indem du sie von Anfang an an die Hand nimmst. Insbesondere wenn da jemand dein Zeug einmalig testen muss.

Die Dokumentation der API ist sehr kurz. Das standardmäßigste wäre ein OpenAPI-Dokument mit sauberer Dokumentation der API. Siehe zum Beispiel unseres: https://app.eqenergy.com/api/docs/

> - The robot is never instructed to move outside the office bounds.
> - The service performs only minimal request validation and relies on the caller to provide valid data.

Ist dies gegeben? Sonst muss man immer vom DAU ausgehen.

Rest der Dokumentation sieht erstmal gut aus.

# task.md

> - **Standard Library:** Use built-in libraries where possible. Justify any extra packages in a README.

Das fehlt in deinem README.

# src/index.ts

Könnte man die Methodenaufrufe vom Setup parallelisieren, um den Start der App schneller zu machen? So wie wir es bei Greenshare machen.

# src/http/errorHandler.ts

Es sieht so aus, als würdest du alle Fehler als 500er zurückgeben. Die Bandbreite der Fehlercodes kann ruhig genutzt werden.

# db/init.sql

`commands` ist ein `INTEGER` und `result` ist ein `BIGINT`. Wieso? Erwartest du sehr große Werte für `results`, aber nicht für `commands`?

`double` ist eine `DOUBLE`. Hier könntest du `BIGINT` verwenden und die `duration` in Millisekunden speichern. Ich bin mir aber nicht ganz sicher, ob `DOUBLE` oder `BIGINT` mehr Speicher verbraucht.

# src/domain

Die `commands` werden als Objekte gespeichert, jeweils mit `direction` und `steps`. Das könnte man in Bezug auf Speicherverbrauch optimieren indem man Vektoren und Matrizen nutzt. Du nimmst das JSON weiterhin entgegen wie gewohnt, aber wandelst es intern um. Zum Teil machst du das auch, nennst es auch `Vector`, aber es ist kein "echter" Vektor.

Hier ein spontaner Entwurf:

Zweidimensionale Vektoren. Der erste Werte beschreibt die Richtung auf der Nord-Süd-Achse, positiv für Nord, negativ für Süd. Der zweite Wert analog für die Ost-West-Achse. Hier ein Beispiel:

Original

```json
  "commands": [
    {
      "direction": "east",
      "steps": 1
    },
    {
      "direction": "south",
      "steps": 1
    },
    {
      "direction": "west",
      "steps": 2
    },
    {
      "direction": "north",
      "steps": 2
    },
    {
      "direction": "east",
      "steps": 2
    }
  ]
```

Optimierung

```json
  "commands": [
    [0, 1],
    [-1, 0],
    [0, -2],
    [2, 0],
    [0, 2]
  ]
```

Wenn du eine große Anzahl an `commands` verarbeitest, kann dir das Speicher sparen. Eine Liste mit zwei Integer benötigt weniger Speicher als ein Objekt mit einem String und einem Integer.

Eine ähnliche Datenstruktur könntest du für die `visited` benutzen. Aktuell hast du ein `Set<String>`. Strings brauchen mehr Speicher als numerische Werte. Darüber hinaus werden für ein Set alle Werte gehasht, was ressourcenintensiv sein könnte. Schlanker wäre ein Tupel oder ein Liste der Länge zwei bestehend aus Shorts oder Booleans, je nachdem, was am wenigsten Speicher benötigt (am besten wär ein Bit, entweder 0 oder 1). Noch schlanker wäre ein Matrix. Jeder Eintrag in der Matrix steht für ein Feld, dass der Roboter besuchen kann. Am Ende zählt man die Einsen (oder True-Werte) zusammen.

Der Knackpunkt dabei ist, die Matrix direkt richtig zu dimensionieren. Ist sie zu groß, verbrauchst du mehr Speicher als nötig. Ist sie zu klein, musst du die Matrix vergrößern, was teuer ist. Wir kommen hier schon in einen Bereich, der mehr sophisticated ist. Könnte eventuell etwas overengineered sein.

Solch eine Optimierung dann ordentlich dokumentieren, damit die das sehen und verstehen.

# Documentation

Der Code ist sehr wenig dokumentiert. Es ist auch nicht so viel Code, aber lieber früher damit anfangen als später. Methoden, Klassen, etc. einmal durchdokumentieren.

# Summary

Es macht insgesamt einen guten Eindruck. Es ist sauber, ordentlich und übersichtlich.

Ein bisschen mehr Dokumentation und kleine Optimierungen.

Ich konnte es nicht testen, da für das Aufsetzen mit Docker eine Internetverbindung benötigt wird und ich im Flugzeug sitze.