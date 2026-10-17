# `.agent/` — configuración de agentes

Este directorio es la **copia canónica** de la configuración de agentes del
proyecto. La comparten Claude Code y OpenCode.

Antes eran dos carpetas, `.claude/` y `.opencode/`, con el mismo contenido
duplicado: 21,9 MB cada una, casi todo un binario de Windows de 19,6 MB y un
índice de fuentes de 1,1 MB. Dos copias del mismo archivo, que además se
podían desincronizar sin que nada lo anunciara.

## Cómo queda

```
.agent/                       ← canónico, se versiona
  skills/impeccable/          el skill, con rutas relativas a .agent/
  README.md                   este archivo

.claude/                      ← adaptador de Claude Code
  agents/*.md                 4 subagentes (descubiertos por nombre)
  skills/impeccable/SKILL.md  shim de 5 líneas → .agent/
  settings.local.json         hooks del detector (lo escribe `impeccable hooks`)

.opencode/                    ← adaptador de OpenCode
  commands/impeccable.md      comando /impeccable
  skills/impeccable/SKILL.md  shim de 5 líneas → .agent/
```

Cada herramienta descubre skills **sólo en su propia carpeta**, así que el shim
no es opcional: es lo que hace que Claude Code encuentre un skill llamado
`impeccable` en `.claude/skills/`. El shim lleva el frontmatter que la
herramienta necesita para descubrirlo, y nada más.

## Por qué los adaptadores no se unifican

`.claude/agents/` y `.opencode/commands/` no están duplicados en ninguna parte:
son específicos de una herramienta, pesan unos pocos KB, y no se pueden
convertir en shim. El contenido de un subagente **es** su prompt de sistema, no
una referencia a otro archivo. Un shim ahí produciría un agente que no hace
nada.

## Al editar el skill

Se edita **sólo** `.agent/skills/impeccable/`. Después:

1. Sube `version` en el frontmatter de `.agent/skills/impeccable/SKILL.md`.
2. Sube la misma `version` en los dos shims, para que las tres copias no
   digan cosas distintas.
3. Si moviste un archivo, actualiza las rutas literales
   `.agent/skills/impeccable/scripts/impeccable` dentro del skill. Hay ~74.

## Lo que no se versiona

`.agent/skills/impeccable/scripts/` trae un binario autocontenido de 19,6 MB
(`bin/windows-x64/impeccable.exe`) y un índice de fuentes de 1,1 MB
(`data/font-index.json`). Están en `.gitignore`: son artefactos de plataforma,
no fuente, y una vez versionados se quedan en el historial para siempre. 20 MB
por copia es exactamente el tipo de peso que uno no quiere dentro de un repo.

El launcher los baja solo en el primer uso si no los encuentra, así que un
clone limpio funciona. Si prefieres no depender de eso, bórralos localmente: el
launcher los recupera cuando los necesita.

## Nota sobre los hooks

`.claude/settings.local.json` e `.impeccable/config.json` los escribe y valida
el propio `impeccable`, no a mano — el propio skill lo dice en
`reference/hooks.md`. Si cambias la ruta del launcher dentro del hook, hazlo
con `/impeccable hooks`, y si algo queda desincronizado, `/impeccable doctor`
lo reporta.
