# Changelog

El formato sigue [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) y
Starless usa [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Starless adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> [!NOTE]
> **0.3.0 es el primer build que alguien pudo descargar.** 0.1.0 y 0.2.0 solo
> existieron en la máquina donde se construyó.
>
> **0.3.0 is the first build anyone could download.** 0.1.0 and 0.2.0 existed only
> on the machine where Starless was built.
>
> **0.1.0 y 0.2.0 se reconstruyeron a partir de las fechas de los archivos**, no
> de un registro: Starless se construyó de una sola sentada y hasta 0.3.0 no tenía
> control de versiones. Son exactos sobre *qué existía*; *qué versión lo introdujo*
> es una inferencia. Desde 0.3.0 hay repositorio y etiqueta, así que `git log`
> reemplaza esa inferencia por un dato.
>
> **0.1.0 and 0.2.0 were reconstructed from file timestamps**, not from a record.
> They are exact about what existed; which version introduced it is an inference.
> From 0.3.0 there is a repository and a tag, so `git log` replaces the inference
> with a fact.
>
> La app muestra estos mismos changelogs dentro de Ajustes → Diagnóstico, en el
> idioma que el usuario eligió. The app shows these same notes inside
> Settings → Diagnostics, in whichever language the user picked.

---

## [0.6.0] — sin publicar / unpublished

### New / Nuevo

- **El jam: la sesión compartida.** El botón está arriba a la derecha, junto a los amigos, y abre el panel de actividad de escucha. Desde ahí se puede **empezar un jam**, ver el **código para compartir** y quién está adentro, entrar a uno con un código y terminarlo. Un jam es una sesión y no una playlist: tiene dueño, invitados y un código, y no tiene nombre ni vive en la biblioteca. El código es toda la invitación —no hay una página que abrir ni un link que seguir—, así que lo que se copia es el código. El panel no lee la sesión al abrirse, a propósito: la única puerta que lee un jam también lo crea, y abrir el panel dejaría un jam abierto en la cuenta de alguien que sólo quería mirar.
- **El orden y la vista de las listas se recuerdan.** El orden —personalizado, título, agregado recientemente, artista o álbum—, su dirección y la vista —Lista o Compacta— se guardan en `%LOCALAPPDATA%\Starless` y sobreviven al cierre de sesión y al reinicio. Antes se perdían al cambiar de lista, y la app siempre arrancaba en el orden por defecto.
- **Los reportes ya no llevan un token dentro de la app.** Para mandar un reporte de crash o un feedback, Starless ahora habla con un relay propio en vez de usar la API de GitHub con una clave escrita en el binario: esa clave salía de la máquina de cada copia instalada. Ahora la copia no lleva ninguna. El relay abre el issue y devuelve el enlace, avisa cuando el mismo crash ya había sido reportado y suma el tuyo, y dice cuándo se pasó el límite de la hora.
- **El feedback dice de qué se trata.** El formulario de Ajustes → Diagnóstico pregunta ahora si lo que se está contando es un problema, una idea u otra cosa, y el tema viaja con el reporte.

### Fixed / Corregido

- **La app iba a 30 fps con la música sonando.** El ecualizador de la fila que suena animaba `height` para siempre, así que la lista entera se volvía a calcular en cada cuadro mientras sonaba música; las barras de posición y de volumen animaban `width` y `left` en cada tic. Ahora animan `scaleY`, `scaleX` y `x`. Y cada cambio en la app —el volumen, la posición, un menú— volvía a dibujar todas las filas de la lista y de la cola, mil de ellas en «Canciones que te gustan»: ahora sólo se dibujan las que están cerca de la pantalla. Antes, cualquier cambio en una lista larga congelaba la ventana entre 300 y 700 milisegundos. Medido con la música sonando, ordenando una lista, moviendo el volumen y abriendo la cola: 60 fps.
- **Las primeras filas de una lista que carga tarde no se dibujaban.** «Canciones que te gustan» carga después de que se abre la pantalla, y la lista se quedaba en blanco: la ventana de filas medía el alto de la fila con dos filas ya dibujadas, y sin filas no había nada que medir. Hasta que lo hay, se dibuja el principio de la lista.
- **Cargar una playlist larga hacía veinte viajes de ida y vuelta.** Los datos de las canciones se pedían de a cincuenta, cada tanda esperando a la anterior, así que mil canciones eran veinte vueltas antes de que se pudiera dibujar la primera fila. Ahora las tandas van de a ocho en paralelo.
- **Los errores se leían en español aunque la app estuviera en inglés.** Las frases de los códigos de error vivían en `lib/spotify.ts`, sólo en español, así que una persona con la app en inglés leía cada error en español. Ahora están en `lib/i18n.ts` con los dos idiomas, y el tipo no compila si a un código le falta el inglés.
- **Los reportes no llegaban a ningún lado y el culpable era el relay.** La dirección del relay llega como variable del repositorio, y una variable que no existe llega como cadena vacía: `option_env!` la da como `Some("")`, que no es lo mismo que `None`. La app posteaba a `/report` —una URL sin host— y culpaba al relay por no contestar, cuando la verdad es que no había relay al que preguntarle.
- **El log dice ahora qué archivo de audio pide la clave.** `error audio key 0 1` es el servicio negando la clave para un archivo, no para la canción, y librespot nunca decía cuál. Ahora, cuando una pista empieza a cargar, el log escribe los formatos que ofrece, el que elige el orden de 160 kbps de librespot y, una vez por sesión, los atributos con los que se mandaron la cuenta. Y el ruido del demuxer —unas quinientas líneas por pista fallada— dejó de empujar todo lo demás fuera de los 48 KB que cabe en un reporte.
- **El volumen tardaba hasta medio segundo en cambiarse.** El mixer atenuaba el audio antes de encolarlo, así que el cambio esperaba a que la cola se vaciara: lo que ya estaba en la cola seguía sonando con el volumen viejo. Ahora el audio sale de la cola sin tocar y el volumen lo baja el mezclador muestra a muestra, así que el cambio se oye en la muestra siguiente.
- **Pausar no pausaba, y el botón de play preguntaba en el orden equivocado.** Lo que ya estaba encolado seguía sonando casi setecientos milisegundos después de pausar, así que la pausa parecía no obeyedida. Y el botón preguntaba «¿estoy sonando?» antes que «¿hay una canción cargada?»: desde el final de una canción o con el reproductor parado, librespot se niega, y la app se ponía en «sonando» sin que sonara nada. Ahora pregunta lo segundo, y el estado que la app cambia sola se lo dice al webview en vez de guardárselo.
- **La barra de posición peleaba con el mouse, y un seek tiraba la cola en la que aterrizaba.** La barra es un control nativo cuyo valor viene del backend dos veces por segundo, y cada actualización la devolvía a donde estaba: el cursor parecía clavado y la búsqueda nunca llegaba. Ahora, mientras la mano está sobre el control, el control dibuja lo que se le pidió, y la búsqueda se manda a mano y no por píxel. Y lo que estaba encolado es el audio del lugar anterior: sonaba encima de la posición nueva y el reproductor volvía a reportar la vieja. La cola ahora se descarta con una rampa corta, porque un corte seco en medio de una onda suena como un chasquido.
- **Las dos canciones del crossfade no se mezclaban: se pisaban.** La que entraba subía de volumen a lo largo de los doce segundos mientras la que salía se quedaba al máximo, así que el oído sólo oía la más fuerte, y la segunda sólo se oía cuando la primera había terminado. Ahora la que sale baja de a poco y la que entra sube con la potencia que queda: **la suma de las dos potencias siempre da uno**, así que la transición nunca suena más fuerte que una canción sola. Y la que entra arranca en su propio comienzo, y dura menos: con doce segundos de crossfade una pista de 3:21 dura 3:09, que es lo que dice la barra.
- **El slider de opacidad repintaba media ventana en cada paso.** Cada movimiento escribía la opacidad del vidrio en la raíz, y la leen todas las superficies de la app —el panel de Ajustes, la cola, los menús—, así que la mitad de la ventana se repintaba por cada paso del dedo. Ahora lo que se aplica a toda la ventana se aplica cuando el dedo se levanta: el número, el cursor y la leyenda contestan a la velocidad del dedo, y los menús cambian una vez, al soltar.
- **La pantalla de inicio de sesión desaparecía de golpe.** Cuando llegaba la sesión, la app estaba y la tarjeta no, sin nada en el medio. Ahora la puerta se desvanece sobre la app que ya está debajo, así que los dos son un movimiento solo. Y el botón ya no se apagaba sin más: dice qué está esperando —la aprobación en el browser, después el handshake con Spotify—, con un spinner, y se queda así hasta que la sesión está de verdad.
- **El panel de Ajustes volvía después de volver a iniciar sesión.** La puerta desmonta lo que tiene detrás cuando se cierra, pero el estado que decide qué se muestra vive arriba de la puerta, así que el panel de la sesión anterior volvía entero sobre la app nueva. Ahora, al cerrarse la sesión, la pantalla vuelve a su estado de partida: se devuelve lo que es de la cuenta —dónde estabas, qué estaba abierto, la cola— y se queda lo que es de la persona —el idioma, el orden de la estantería, el vidrio—, porque una preferencia no se la lleva cerrar sesión.
- **La app quedaba atrás del browser después de iniciar sesión.** El browser toma el primer plano para la aprobación, y cuando contesta «Listo. Vuelve a Starless.» la persona está mirando el browser, no la app —que había quedado detrás, sin nada en pantalla que dijera que estaba esperando—. Ahora la app vuelve sola al frente en cuanto el browser termina.

---

## [0.5.5] — 2026-10-28 · prerelease

### New / Nuevo

- **Elegir una canción de la búsqueda entra directo a la radio de esa canción.** Las otras que salieron de la búsqueda ya no suenan: el usuario eligió una, y el resto de los resultados no es una lista que nadie pidió. La radio es la de Spotify —la misma puerta que usa el autoplay del cliente oficial— y la canción suena ya, con las parecidas detrás.
- **Las canciones se encadenan solas.** Cuando una termina por sí sola, la siguiente empieza esos segundos antes y las dos se mezclan: no hay un silencio en el medio. El ajuste vive en Ajustes → Audio y va de apagado a doce segundos, y se recuerda en esta máquina. Un clic en otra canción nunca funde: esa suena ya.

### Fixed / Corregido

- **La música se cortaba cuando una lista se acababa.** Ahora, al terminar la cola, Starless le pregunta a Spotify qué sigue con lo parecido a lo que se estaba escuchando y sigue con canciones parecidas, como hace el autoplay. Con la repetición en «todo» la lista vuelve a empezar, como antes.
- **La app se ofrecía a sí misma como actualización.** Una release pública puede llevar dentro una build de `develop`, y esa build se cree en la línea de desarrollo: busca la puerta de vuelta a la línea pública y se encuentra a sí misma, así que el botón ofrece instalar lo que ya está instalado —y el instalador es el mismo binario, así que el bucle no termina nunca. Ahora la app compara el commit de la build que está corriendo con el de la release pública, y cuando son el mismo no hay nada que instalar: dice que estás al día y la pastilla dice «pública» en vez de «pre-release».
- **La pre-release no se instalaba.** El botón de instalar la pre-release fallaba siempre, desde la 0.5: la app guardaba la actualización en la tabla de recursos de la aplicación, y el instalador de Tauri la busca en la de la ventana —dos tablas distintas—, así que el fallo pasaba antes de descargar un solo byte. Ahora la actualización se registra donde el instalador la va a buscar, así que la pre-release se descarga y se instala. Lo mismo arregla la puerta de vuelta a la línea pública. Y el motivo de un fallo de actualización ahora queda en el log, que antes sólo vivía en una consola que nadie abre.

---

## [0.5.4] — 2026-10-26 · prerelease

### New / Nuevo

- **La playlist tiene sus tres puntos, al lado del botón de reproducción.** Abren un menú con tres cosas: mandarla entera a la cola, editar sus detalles y copiar su enlace.
- **Editar los detalles es una pantalla con la portada, el nombre y la descripción.** La portada se cambia pasando el mouse por encima: aparece un lápiz y un «Elegir una foto», y el archivo se recorta y se sube al guardar. También se puede devolver la portada que puso el dueño y volver a la que arma Spotify con las primeras canciones.
- **La misma pantalla trae un interruptor: «Hacerla privada».** La playlist deja de aparecer en tu perfil público, y el encabezado lo dice.
- **El menú tiene tres filas y no doce.** El cliente de escritorio ofrece también el jam, los colaboradores, la descarga, las carpetas y el borrado, y ninguno de esos tiene puerta en esta sesión. Editar los detalles sí: es el mismo mensaje que crea una playlist —un `UPDATE_LIST_ATTRIBUTES`— contra la revisión que la playlist tiene ahora, en vez de la `0,root` de una que todavía no existe.

### Fixed / Corregido

- **La app tardaba 5,5 segundos en mostrar la biblioteca.** Los pedidos salían antes de que la sesión terminara de conectar, así que fallaban, y el frontend los reintentaba cuatro segundos después: la espera estaba en el reintento y no en la conexión. Ahora el backend espera a que la sesión esté lista y responde de una.
- **El DJ se quedaba mudo un par de segundos antes de la frase que cierra un tramo.** El audio se pedía por adelantado, pero sólo para las páginas siguientes: la primera se pedía en el momento de hablarla. Ahora la primera página también lo pide, y la misma frase nunca se pide dos veces.
- **La build de develop con el mismo número que la pública decía que estabas al día.** El plugin sólo contesta cuando los números difieren, así que la puerta de vuelta a la línea pública quedaba cerrada para quien corría la 0.5.3 de develop. Ahora el manifest público se pide en Rust y la fila ofrece instalar la versión pública del mismo número.
- **El log dice cuánto tarda cada lectura.** «Cargar la biblioteca es lento» no es un error que nadie pueda arreglar; «la biblioteca tardó 1211 ms» sí.
- **La cola se paraba en vez de seguir.** Al cambiar de playlist mientras sonaba, la app perdía el lugar de la canción en la cola, y al terminar repetía la misma canción: en el segundo final se paraba y no pasaba a la siguiente. Ahora el lugar se resuelve en el momento del final, y un final más de la misma canción —que el DJ ofrece dos veces— también avanza.

### Copy / Textos

- **Los textos de la app ya no usan el voseo y son más cortos.** «Prerelease de develop» no explica qué es develop: dice lo que hace.
- **Las notas de cada versión se reescribieron en español neutro y más corto**, en la app y en GitHub.

### Changed / Cambiado

- **La release lleva un solo instalador, y es el `.msi`.** Hasta la 0.5.3 había dos —el `.exe` de NSIS y el `.msi`—, y la página tenía cinco archivos para descargar. Ahora son tres: el instalador, su firma y el manifest. El nombre del instalador tampoco lleva el idioma encima: `Starless_0.5.4_x64.msi` y no `Starless_0.5.4_x64_en-US.msi`.
- **Si instalaste con el `.exe`, instala el `.msi` una vez.** El `.msi` instala para toda la máquina y el `.exe` lo hacía sólo para el usuario: Windows pide permiso de administrador, y quedan dos copias en la máquina hasta que desinstales la vieja. A partir de ahí las actualizaciones son del `.msi`.

---

## [0.5.3] — 2026-10-23 · prerelease

### Fixed / Corregido

- **El botón de «Buscar prerelease» no encontraba nada y hacía parecer que GitHub estaba caído.** Tres motivos: el manifest se bajaba desde el frontend, detrás de una redirección a otro host sin cabeceras CORS; la API de GitHub responde 403 sin `User-Agent` y la biblioteca HTTP no lo manda solo; y la lista de releases es un índice que va con retraso. Ahora el canal se resuelve entero en el backend —etiquetas, release y manifest—, sin CORS de por medio.
- **Si GitHub limitó las consultas desde esa máquina, la fila lo dice.** El límite es de sesenta consultas por hora y por dirección, y agotarlo se ve igual que una caída: un 403 sin explicación. Ahora la fila distingue los dos casos: uno se acaba y el otro no.
- **La línea pública también es una puerta.** Desde una prerelease, la release pública sólo se ofrecía si era más nueva, así que no había forma de volver a la línea estable. Ahora se ofrece igual —aunque sea más vieja— y la fila lo dice antes de hacerlo: «Volver a la 0.5.1». La pastilla de Ajustes y la alerta del arranque no la anuncian: un «0.5.1» mientras corres 0.5.3 es una vuelta atrás.

---

## [0.5.2] — 2026-10-23 · prerelease

### Fixed / Corregido

- **El botón de «Buscar prerelease» no encontraba la prerelease.** La app preguntaba a la lista de releases de GitHub, y esa lista es un índice que va con retraso: la release existe desde que se publica, pero la lista que la apunta tarda unos minutos más. Con la 0.5.1 recién publicada, el botón decía «No hay prerelease» mientras GitHub mostraba una. Ahora el camino va por las etiquetas —que existen desde que se empuja el tag— y cada una se pregunta por su nombre.
- **La prerelease se encontraba pero no se podía instalar.** El frontend armaba el `Update` con el JSON del manifest, pero un `Update` del plugin es un handle a un recurso que vive en Rust: sin el `rid` que devuelve el backend no hay nada que descargar. Ahora es el backend el que apunta el manifest —con el mismo updater, la misma llave y la misma verificación de firma— y lo que vuelve es instalable.
- **Una descarga que falla ahora lo dice.** Antes la promesa se rechazaba sola: el botón no cambiaba y nada explicaba por qué. Ahora la fila dice que la descarga falló, que la copia instalada no cambió, y deja el botón para reintentar.

---

## [0.5.1] — 2026-10-22 · prerelease

### New / Nuevo

- **La app ahora dice si es una pre-release.** Junto a la versión en Ajustes aparece una pastilla «pre-release» cuando la build salió de `develop`; en una release no aparece nada. El ícono invertido ya lo decía, pero sólo para quien sabe qué significa: dos copias de la app en la misma máquina se veían iguales, y ahora se distinguen.

### Fixed / Corregido

- **La app se abría con una cola que nadie había pedido.** Al abrir Starless, el panel «A CONTINUACIÓN» traía las canciones que se veían en pantalla: ocho canciones bajo un encabezado de cola, antes de que sonara una sola. Ahora la cola no existe hasta que la creas: hasta que suena algo, el panel dice que no hay nada en cola.
- **Agregar una canción a la cola convertía la pantalla entera en cola.** Sin cola, la canción agregada era la cola: quedaban ocho canciones en el panel, siete de las cuales nunca pediste. Ahora, sin cola, la canción agregada *es* la cola —y queda una sola—; con cola, se agrega al final, como siempre.

---

## [0.5.0] — 2026-10-22 · prerelease

### New / Nuevo

- **El DJ de Spotify ahora suena, y se escucha.** La tarjeta de la repisa de Inicio —la que decía «0 canciones»— no es una playlist: su contenido hay que pedirlo aparte. Al hacer clic arranca la primera canción y el DJ sigue eligiendo: la cola se llena sola con las páginas siguientes de su sesión, así que no se acaba como una lista y cada vez trae material nuevo. La voz del DJ también se oye: la pide el servicio que la fabrica, sale por el mismo auricular que la música, con el mismo volumen —si lo bajas, baja el del DJ— y queda escrita arriba de la cola, en nombre del DJ. Y la tarjeta se ve como la de Spotify, con su fondo azul y su medusa, en vez de un cuadro vacío, indistinguible de una portada rota.
- **El DJ habla antes de que empiece la música.** Cuando lo tocas, Starless corta lo que estaba sonando, deja que el DJ diga su frase —con su ícono abajo a la izquierda, en la barra— y recién después arranca la canción. Si pones una canción mientras habla, la frase se corta: estaba dicha para otra. Con el DJ sonando la cola no muestra qué viene después: el DJ sigue eligiendo, así que lo que viene no está decidido, y la frase es una sorpresa.
- **El DJ vuelve a hablar en cada tramo.** La frase va pegada a su canción, no a la tanda: la de apertura abre el tramo con la primera y la de cierre lo cierra con la última, y las dos se dicen antes de que suene esa canción. Antes Starless la pedía una sola vez, cuando le devolvía la tanda, así que después de la primera canción el DJ se callaba para siempre —la frase siguiente aparecía escrita arriba de la cola y nadie la decía—.
- **El DJ tiene su botón en la barra**, como en el cliente oficial. Aparece con la sesión del DJ y desaparece con ella, y hace el mismo camino que la card: el DJ no arranca de cero, sigue su propia sesión y pasa a la tanda siguiente. Es la marca del DJ —el anillo de la medusa— en un solo color, porque la barra es cromo y el cromo va en tinta.
- **La barra de reproducción ya no está ahí desde que abres la app.** Antes aparecía con un fundido al abrir la ventana, y lo que aparecía era un rectángulo de vidrio vacío: un play apagado, dos ceros y nada a la izquierda. Ahora la barra llega con la música —cuando pones una canción, o cuando el DJ empieza a hablar— y antes de eso la ventana es sólo la biblioteca. Y la ventana le hace lugar: la biblioteca, el riel y la cola bajan hasta el borde mientras no hay barra, y suben cuando la música llega.
- **La pantalla de playlists.** Abres una de tus listas y la ves como en Spotify: el mosaico de portadas, el nombre, quién la armó, cuántas canciones tiene y cuánto dura, los botones de reproducir y de aleatorio —el de aleatorio sólo enciende el modo, no empieza a sonar—, y la tabla con número, título, álbum, la fecha en que la agregaste y la duración. Puedes filtrarla y ordenarla, el nombre del artista y el del álbum llevan a su ficha, y cada canción tiene su menú. La lista que ves es la que suena: filtrar o reordenar cambia lo que viene después.
- **Desde el menú de cada canción se puede agregar a una playlist**, y también crear una playlist nueva desde ahí, con la canción ya adentro. Se escribe por la misma sesión con la que Starless reproduce: no hay ningún permiso nuevo ni una segunda pantalla de autorización.

### Fixed / Corregido

- **Starless saltaba para atrás, y a veces arrancaban dos canciones a la vez.** El «siguiente» se decidía buscando por su id la canción que estaba sonando, y el DJ ofrece la misma canción dos veces: la app encontraba la primera copia —la que ya había sonado— y de ahí el salto era a una canción del pasado. Ahora la app recuerda en qué lugar de la cola está, y cada pedido de reproducción lleva un número: si mientras tanto pediste otra cosa, la respuesta que llega tarde no pone ninguna canción encima de la que ya está sonando. En el log se veía: dos canciones arrancando con 19 milisegundos de diferencia.
- **El DJ repetía las mismas canciones.** No era cosa de Spotify: Starless le preguntaba al servicio por la línea de tiempo desde el principio, y esa línea siempre empieza igual. Ahora le pregunta por el tramo de ahora —la misma puerta que usa el cliente de Spotify—, así que cada vez que lo tocas arranca con canciones distintas y la cola sigue llenándose con material nuevo.
- **Con el DJ hablando, el volumen y el transporte quedaban bloqueados.** El control de volumen quedaba en gris y no se podía tocar, y el botón de siguiente tampoco. Ahora la barra no está apagada mientras el DJ habla: la música viene, y el volumen es justamente lo que se quiere bajar —la voz es lo más fuerte de la sala—. Y el botón de reproducir corta la frase y deja sonar la canción que el DJ eligió.
- **Cuando salteabas, se oía un pedazo de la canción anterior antes de que el DJ hablara.** La música se cortaba recién cuando el audio de la frase ya estaba listo, un par de segundos después del clic: la app seguía con la canción que ya habías salteado. Ahora la música se calla en el momento, y el audio de la frase se pide por adelantado.
- **Se cayó la conexión con Spotify y Starless se la levanta.** Antes saltaba canción tras canción diciendo que esa no se pudo reproducir —la pista estaba bien, lo que faltaba era la conexión— y terminabas viendo seis errores seguidos. Ahora la app avisa que está reconectando, arma una sesión nueva con las mismas credenciales y vuelve a poner la canción que había fallado.
- **Starless se quedaba mudo y no volvía.** Cuando el dispositivo de salida dejaba de tomar el audio, el hilo que reproduce se quedaba esperando para siempre —no estaba muerto: estaba esperando— y la app seguía mandándole cosas que nadie leía. La ventana se veía perfecta y no sonaba nada. Ahora la app lo nota, deja el reproductor viejo atrás sin esperar a que vuelva, abre otro y pone la canción de nuevo.
- **Starless perdía la música y no la recuperaba.** Si la conexión con Spotify se caía con la cola vacía, la app ni se enteraba: la reconexión está atada a una canción que falla, y con la cola vacía no falla ninguna. La conexión se quedaba muerta —y el DJ, que habla por su propio camino, seguía hablando—. Ahora un clic arma la sesión nueva y vuelve a poner la canción que pediste.

### Removed / Eliminado

- **El apartado «Reproducido recientemente» de la cola se fue por ahora.** El backend todavía no sabe qué se escuchó antes, y un encabezado sobre una lista vacía es una promesa que la app no puede cumplir. Cuando haya algo que contar, vuelve.

---

## [0.4.0] — 2026-10-18 · prerelease

### New / Nuevo

- Cuando hay una versión nueva, Starless lo dice: una alerta flotante que aparece una vez y se desvanece sola, el botón de Ajustes queda marcado en verde, y dentro de Ajustes el botón de actualizar se pone en verde con la versión disponible. Nada se descarga ni se instala solo — instalar sigue siendo un clic tuyo, en Ajustes, porque Starless está sonando.
- Un fallo al comprobar no marca nada. Si GitHub no se puede alcanzar, eso dice algo de la red y nada de tu instalación, así que el botón se queda como estaba.
- **Letra de las canciones.** Botón en la barra de abajo, al lado del botón de cola. Sigue la posición del audio línea por línea cuando el proveedor manda los tiempos, y avisa que no puede seguirlas cuando no los manda —en vez de quedarse clavada en la primera toda la canción—. Cada línea con tiempo es un botón: haz clic y la canción salta a ese minuto. Viene por la misma sesión que ya reproducía: ni un permiso nuevo, ni un client id propio. Este apartado es para el gordito `kaliuchisfangirl`.

### Fixed / Corregido

- Para casi todo el mundo, la biblioteca salía vacía y no decía por qué. Spotify dejó de entregar datos a las apps nuevas salvo a cinco cuentas en una lista. Starless ahora lee la biblioteca, las playlists, las guardadas y la búsqueda por la misma sesión con la que reproduce, y si algo falla al leerla la app lo dice en vez de mostrar un vacío.
- Dos Starless abiertas a la vez ya no pueden pasar. Antes competían por las claves de audio y la que perdía le pasaba sus bytes a la otra: seis canciones quemadas en catorce segundos, todas reportadas como canciones que Spotify no entregaba. Ahora la segunda copia sube la ventana de la que ya está y se cierra.
- Se cayó la conexión con Spotify y Starless lo dice. Antes saltaba canción tras canción diciendo que esa canción no se pudo reproducir —la pista estaba bien, lo que faltaba era la conexión—, y como la sesión de reproducción no vuelve sola, terminabas viendo seis errores en catorce segundos. Ahora dice qué pasó y para. Hay que cerrar y abrir la app.
- Las portadas de tus playlists vuelven. Spotify no las manda al leer la biblioteca, pero sí las tiene en otro lado, y ahora Starless las busca ahí: son las imágenes de Spotify, no un mosaico dibujado por la app.
- El botón de Inicio vuelve al inicio de verdad. Antes sólo cambiaba una pestaña y dejaba la playlist abierta en pantalla.
- Hay una pantalla principal. Antes «Inicio» era la lista de canciones que te gustan con otro nombre: una lista de cosas que ya elegiste, que es mala forma de decidir qué escuchar después. Ahora es una repisa con tus playlists y, aparte, lo que Spotify te fabricó —hoy, DJ—. **No hay fila de filtros ni recomendaciones**: salen del motor de recomendaciones de Spotify, que estaba detrás de la Web API que ya no funciona, y se probaron catorce URIs contra la sesión disponible sin que ninguna respondiera.
- Arreglada la cola después de buscar. Elegir una canción del desplegable, o hacer clic dentro de la playlist que ya estaba abierta, dejaban la cola de la lista anterior —buscabas una canción y después seguían las que te gustan—. Ahora cada lista define la cola que la sigue.
- El botón de aleatorio ahora se ve. Antes sorteaba una canción distinta en cada salto pero el panel de cola seguía mostrando el mismo orden de siempre: lo que estaba al lado contradecía lo que sonaba. Ahora al prenderlo se decide un orden nuevo, se ve en el panel y se mantiene; apagarlo no lo deshace.

### Changed / Cambiado

- Entrar es una sola aprobación. Antes se pedía permiso dos veces —una para reproducir y otra para leer la biblioteca— y la segunda era la que empezaba a devolver errores.
- La pantalla de resultados es una lista de canciones en orden alfabético.
- Reproducir desde la pantalla de inicio arma una cola nueva cada vez. Una playlist es una afirmación sobre el orden, así que abrirla y reproducir respeta ese orden; desde cualquier otro lugar no. Antes siempre salía la misma cola y terminabas escuchando las mismas canciones seguidas. Las playlists siguen sonando en el orden en que están.

### Removed / Eliminado

- Las pestañas de álbumes, artistas y playlists en los resultados, la discografía del artista, y agregar a o crear playlists. La ruta que las alimentaba ya no existe y no hay otra que devuelva la verdad.

---

## [0.3.2] — 2026-10-17

### Fixed / Corregido

- Al abrir otra playlist, la lista arrancaba a la altura donde habías dejado la anterior. Ahora cada lista arranca en su propio arriba.
- Las filas de una lista aparecían con huecos entre medio durante unos segundos: la cascada de entrada no tenía tope, así que en una playlist de 198 canciones la última fila esperaba casi seis segundos en ser visible. Ahora la cascada se detiene en la primera docena.
- Abrir una playlist mostraba filas de la anterior. Una playlist puede tener la misma canción dos veces, y con esa fila compartida entre dos canciones React dejaba las filas viejas montadas, pintando la lista previa debajo del nombre y el conteo de la nueva. Cuatro canciones repetidas en «Mi playlist n.º 4» eran cuatro filas de más en cada lista que abrieras después.
- Pasar el cursor por las playlists volvía a descargar todas sus páginas, una y otra vez: el precargado se guardaba ya vencido, así que el `staleTime` de cinco minutos del hook no llegaba nunca a aplicarse. Una playlist larga se descargó seis veces completas en diez segundos.
- Después de una actualización, la app siguiente abría pidiendo el reporte de un crash que nunca hubo. El actualizador entrega el instalador a Windows y el proceso se va antes de que se pueda cerrar la sesión a tiempo, así que el marcador de sesión sobrevive.
- Una sesión que moría a los pocos segundos ya no cuenta como caída. Un cierre abrupto se distingue de un crash por lo único que los separa: cuánto vivió.
- El español estaba escrito en voseo rioplatense. Ahora es neutro.

---

## [0.3.1] — 2026-10-17

Cerrar sesión, abrir, reportar. / Sign in, open, report.

### Added / Añadido

- El feedback se puede escribir también desde la pantalla de inicio de sesión. A quien la app no le funciona ya no tiene que iniciar sesión para contarlo: esa pantalla era, irónicamente, justo donde no había dónde escribir.
- Una pestaña de Personalización en Ajustes, con el primer ajuste propio: qué tan opacos son los menús. Se recuerda entre arranques, y una muestra al lado del deslizador deja ver el resultado mientras lo mueves.

### Fixed / Corregido

- Cada arranque mostraba la pantalla de inicio de sesión un instante antes de la app, aunque la sesión estuviera guardada. Ahora se espera en silencio y solo pregunta cuando de verdad no hay sesión.
- Enviar un reporte caía en una página de error de GitHub: la URL era demasiado larga. Ahora entra, y el recorte se lleva el final del log —que es donde está la falla— en vez de la cabecera.
- El botón de enviar estaba apagado y sin decir por qué cuando el mensaje estaba vacío. Un clic que no hace nada es indistinguible de un clic roto.
- La sesión se caía sola una hora después de entrar. Si Spotify respondía a una renovación con un solo token de acceso, Starless guardaba el token de refresco vacío encima del que sí servía; en el vencimiento siguiente ya no había con qué renovar y sólo quedaba volver a iniciar sesión.

### Changed / Cambiado

- El formulario de feedback y el aviso de caída ya no se apilan sobre otro panel de vidrio, que `DESIGN.md` prohíbe: ahora llevan un velo plano detrás.
- La build compilada salía con el vidrio **sin difuminado**. El minificador de Tailwind se comía el `backdrop-filter` estándar y dejaba solo el prefijo `-webkit-`, que WebView2 ignora: al 55% se leían las canciones de atrás a través del panel, mientras `bun run dev` se veía perfecto porque ahí el CSS no pasa por el minificador. Ahora el vidrio sale difuminado, y qué tan opaco es lo eliges en Ajustes → Personalización.
- El ajuste de opacidad también alcanza a la cola y a los ajustes, no sólo a los menús flotantes.

---

## [0.3.0] — 2026-10-17

La primera versión pública. / The first public release.

### Added / Añadido

- Búsqueda con sugerencias que se abren bajo el campo, sin quitar lo que estabas leyendo.
- Pestañas en los resultados: Todo, Canciones, Álbumes, Playlists y Artistas.
- Perfil de artista con su discografía y sus canciones.
- Reproducir un álbum entero desde su tarjeta, con cola propia.
- Agregar una canción a una playlist, y crear la playlist desde ahí mismo.
- Registro a archivo local, con rotación, y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.
- Actualizaciones automáticas: Starless comprueba si hay una versión nueva al abrir y tú decides cuándo instalarla.
- Estos changelogs, en Diagnóstico.
- Detección de caídas: si la app no se cerró bien, Starless lo nota y te ofrece enviar el reporte, con el log ya recortado y sin datos personales. No sale un solo byte de tu máquina hasta que lo mandas.
- Feedback dentro de la app, en Ajustes → Diagnóstico. El log va adjunto solo si lo pides.
- El volumen se recuerda entre arranques.
- Un ícono nuevo: una estrella que se apaga.
- La ventana ya no usa la barra de título del sistema. Minimizar, maximizar y cerrar viven a la derecha del buscador.

### Fixed / Corregido

- No sonaba nada: Spotify rechaza el client token de las apps nuevas. Ahora la sesión de reproducción y la Web API usan identidades distintas.
- Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.
- Todas las playlists decían «0 canciones» porque Spotify eliminó el total. El conteo ahora es exacto: se cuenta lo que se cargó.
- Una canción retirada vaciaba la biblioteca entera.
- La app se caía al escribir en el buscador: la política de reintento recibía un error que no era el tipo que esperaba.
- Cerrar sesión dejaba cacheado un «no has iniciado sesión» que sobrevivía al reinicio.
- Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.
- La biblioteca se vaciaba sola alrededor de una hora después de iniciar sesión: el refresco del token corría en el hilo asíncrono, entraba en panic y se llevaba por delante todas las llamadas a la Web API sin dejar una línea en el log.
- Un cliente HTTP que fallaba al construirse quedaba cacheado como fallo, así que un mal arranque llenaba la biblioteca de vacío hasta reiniciar la app.
- Enviar un reporte congelaba la ventana mientras hacía la petición.

### Changed / Cambiado

- Escribir ya no borra la pantalla principal. Enter es lo que decide.
- Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.
- Las consultas que Spotify responde con 503 se reintentan una vez: es su borde, no la petición.
- El botón de la cola vive solo en la barra de reproducción; también estaba arriba.
- Cerrar sesión se mudó de Biblioteca a Ajustes → Cuenta, y ahora funciona: el botón que estaba ahí no hacía nada.
- El selector de idioma salió de la barra superior y vive en Ajustes → General.
- El botón de inicio muestra una casa en vez de un disco.

---

## [0.2.0] — reconstruido / reconstructed

Nunca se publicó. / Never published.

### Added / Añadido

- Inicio de sesión con Spotify por OAuth. La app nunca ve tu contraseña.
- Audio de verdad: el PCM va de librespot al driver de Windows por WASAPI, sin pasar por la ventana.
- Tu biblioteca: canciones que te gustan y tus playlists, con el conteo exacto.
- Barra de reproducción con datos reales: portada, aleatorio, anterior, pausa, siguiente y repetir.
- Cola de reproducción, con lo que suena y lo que sigue.
- Agregar una canción a una playlist, y crear la playlist desde ahí.
- Registro a archivo local y autodiagnóstico con `STARLESS_DIAGNOSTIC=1`.

### Fixed / Corregido

- No se podía reproducir nada: Spotify rechaza el client token de las apps nuevas, así que la sesión de reproducción y la Web API usan identidades distintas.
- Las playlists devolvían 403 tras la migración de Spotify de febrero de 2026. El endpoint se llama `/items` ahora, no `/tracks`.
- Todas las playlists decían «0 canciones» porque Spotify eliminó el total. Ahora se pagina hasta el final y el conteo es exacto.
- Una canción retirada vaciaba la biblioteca entera.
- Abrir una playlist hacía un handshake TLS completo cada vez: ahora el cliente HTTP se comparte.

### Changed / Cambiado

- Premium se pide y se explica temprano, porque sin Premium Spotify no entrega audio.
- Una canción que no se puede reproducir se salta, hasta cinco seguidas antes de rendirse.

---

## [0.1.0] — reconstruido / reconstructed

Nunca se publicó. / Never published.

### Added / Añadido

- La app de escritorio: ventana, proceso de Rust y estructura de comandos.
- El sistema visual: vidrio translúcido, paleta y tipografías definidas en DESIGN.md.
- Interfaz bilingüe, español e inglés, con selector.
- La versión en un solo lugar, con un script que la propaga a los tres manifiestos y falla en CI si discrepan.

---

[0.5.3]: https://github.com/baironvillar/Starless/releases/tag/v0.5.3
[0.5.2]: https://github.com/baironvillar/Starless/releases/tag/v0.5.2
[0.5.1]: https://github.com/baironvillar/Starless/releases/tag/v0.5.1
[0.5.0]: https://github.com/baironvillar/Starless/releases/tag/v0.5.0
[0.4.0]: https://github.com/baironvillar/Starless/releases/tag/v0.4.0
[0.3.2]: https://github.com/baironvillar/Starless/releases/tag/v0.3.2
[0.3.1]: https://github.com/baironvillar/Starless/releases/tag/v0.3.1
[0.3.0]: https://github.com/baironvillar/Starless/releases/tag/v0.3.0