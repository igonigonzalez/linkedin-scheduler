import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacidad · LinkedIn Scheduler",
  description: "Qué datos guarda LinkedIn Scheduler y cómo borrarlos.",
};

export default function PrivacyPage() {
  return (
    <main className="legal">
      <a className="legal-back" href="/">← Volver</a>
      <h1>Privacidad</h1>
      <p className="legal-updated">29 de septiembre de 2026</p>

      <p>
        LinkedIn Scheduler guarda lo mínimo para publicar en tu perfil de LinkedIn cuando tú lo programas.
        El responsable de este servicio es YAMATO.
      </p>

      <h2>Qué se guarda</h2>
      <ul>
        <li>Identificador, nombre y foto de tu perfil de LinkedIn.</li>
        <li>Los tokens de acceso y de refresco que LinkedIn entrega al conectar la cuenta, para publicar sin pedirte permiso cada vez.</li>
        <li>El texto de los posts, el primer comentario, la fecha y los archivos que adjuntas (imagen, vídeo o documento).</li>
      </ul>

      <h2>Para qué</h2>
      <p>
        Esos datos solo se usan para mostrar tu cola, subir el archivo y crear el post y el primer comentario en tu perfil.
        No se venden ni se usan para publicidad. Al publicar, el texto y el archivo se envían a LinkedIn, que los trata con su propia política.
      </p>

      <h2>Dónde están</h2>
      <p>
        La cuenta, los posts y los archivos están en Supabase, en un almacén privado. Las vistas previas usan enlaces temporales.
        La sesión en el navegador es una cookie firmada que identifica tu cuenta en esta app.
      </p>

      <h2>Cuánto tiempo</h2>
      <p>
        Se conservan hasta que pulsas <strong>Borrar mis datos</strong> en la barra lateral. Eso revoca el token en LinkedIn,
        borra la cuenta, los posts programados y los archivos de esta app, y cierra la sesión.
        Lo que ya se publicó en LinkedIn sigue allí; hay que borrarlo desde LinkedIn.
      </p>

      <h2>Cerrar sesión</h2>
      <p>
        Cerrar sesión solo quita la cookie de este navegador. La conexión y los posts siguen guardados hasta que borres los datos.
      </p>
    </main>
  );
}
