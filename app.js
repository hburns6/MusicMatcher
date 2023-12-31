const express = require("express");
const session = require('express-session');
const bodyParser = require('body-parser');

const app = express();

app.set("views", "./views");
app.set("view engine", "pug");

app.use(express.static("public"));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Initialize express-session middleware
app.use(
  session({
    secret: 'yourSecretKey', // Change this to a secret string
    resave: false,
    saveUninitialized: true
  })
);


const redirect_uri = "http://localhost:3000/callback";
const client_id = "33c3a45c1db24e6aa74fe79b268eadfb";
const client_secret = "21f632a9010a4c8782466d22eec429ef";

app.get("/", function (req, res) {
  res.render("index");
});

app.get("/authorize", (req, res) => {
  var auth_query_parameters = new URLSearchParams({
    response_type: "code",
    client_id: client_id,
    scope:
      "user-library-read, playlist-read-private, playlist-modify-public, playlist-modify-private, user-top-read",
    redirect_uri: redirect_uri,
  });

  res.redirect(
    "https://accounts.spotify.com/authorize?" + auth_query_parameters.toString()
  );
});

app.get("/callback", async (req, res) => {
  const code = req.query.code;

  var body = new URLSearchParams({
    code: code,
    redirect_uri: redirect_uri,
    grant_type: "authorization_code",
  });

  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "post",
    body: body,
    headers: {
      "Content-type": "application/x-www-form-urlencoded",
      Authorization:
        "Basic " +
        Buffer.from(client_id + ":" + client_secret).toString("base64"),
    },
  });

  const data = await response.json();
  global.access_token = data.access_token;

  res.redirect("/dashboard");
});
async function getData(endpoint) {
  const response = await fetch("https://api.spotify.com/v1" + endpoint, {
    method: "get",
    headers: {
      Authorization: "Bearer " + global.access_token,
    },
  });
  const data = await response.json();
  return data;
}

app.get("/dashboard", async (req, res) => {
  const userInfo = await getData("/me");
  const tracks = await getData("/me/tracks?limit=10");

  res.render("dashboard", { user: userInfo, tracks: tracks.items });
});

app.get("/recommendations", async (req, res) => {
  const artist_id = req.query.artist;
  const track_id = req.query.track;
  const params = new URLSearchParams({
    seed_artist: artist_id,
    seed_tracks: track_id,
  });

  const data = await getData("/recommendations?" + params);

  res.render("recommendation", { tracks: data.tracks });
});

app.get("/playlist", async (req, res) => {
  const playlist = await getData("/me/playlists?limit=5&offset=0");

  res.render("playlist", { playlist: playlist.items });
});

async function getUserProfile(access_token) {
  const response = await fetch("https://api.spotify.com/v1/me", {
    method: "get",
    headers: {
      Authorization: "Bearer " + access_token,
    },
  });

  if (response.ok) {
    const data = await response.json();
    return data.id; // Extract the user's Spotify ID from the response
  } else {
    throw new Error("Failed to fetch user profile");
  }
}

// Route to render the settings page
app.get('/settings', (req, res) => {
  res.render('settings');
});

// Route to handle form submission from the settings page
app.post('/settings', (req, res) => {
  const { numOfSongs, tempo, energy } = req.body;

 // Initialize req.session if it doesn't exist
  req.session = req.session || {};

  req.session.numOfSongs = numOfSongs;
  req.session.tempo = tempo;
  req.session.energy = energy;

  console.log(req.session);

  res.redirect('/dashboard'); // Redirect to the dashboard or any other page
});


app.get("/newplaylist", async (req, res) => {
  try {

    const numOfSongs = req.session.numOfSongs || 20; // Default to 20 if not set
    const tempo = req.session.tempo || null;
    const energy = req.session.energy || null;


    // Get the user's Spotify ID
    const spotifyUserId = await getUserProfile(global.access_token);

    // Get the user's liked songs
    const likedSongs = await getData("/me/tracks?limit=50");

    // Extract the first track ID from liked songs
    const firstTrackId = likedSongs.items[0].track.id;

    // Get song recommendations based on the first track ID
    const recommendations = await getRecommendations(firstTrackId, numOfSongs, tempo, energy);

    // Create an empty playlist
    const playlistResponse = await fetch(
      "https://api.spotify.com/v1/users/" + spotifyUserId + "/playlists",
      {
        method: "post",
        headers: {
          "Content-type": "application/json",
          Authorization: "Bearer " + global.access_token,
        },
        body: JSON.stringify({
          name: "New Playlist",
          description:
            "New Playlist from MusicMatcher - Based on your most recently liked song",
          public: false,
        }),
      }
    );

    if (playlistResponse.ok) {
      const playlistData = await playlistResponse.json();

      // Extract the playlist ID from the response
      const playlistId = playlistData.id;

      // Add recommended tracks to the playlist
      const addTracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "post",
          headers: {
            "Content-type": "application/json",
            Authorization: "Bearer " + global.access_token,
          },
          body: JSON.stringify({
            uris: recommendations.map((track) => track.uri),
          }),
        }
      );

      if (addTracksResponse.ok) {
        res.render("newplaylist", { playlist: playlistData });
        console.log("Playlist created successfully:", playlistData);
      } else {
        const errorData = await addTracksResponse.json();
        throw new Error(
          `Failed to add tracks to the playlist. Status: ${
            addTracksResponse.status
          }, Error: ${JSON.stringify(errorData)}`
        );
      }
    } else {
      const errorData = await playlistResponse.json();
      throw new Error(
        `Failed to create playlist. Status: ${
          playlistResponse.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating playlist");
  }
});

// track recommendations
async function getRecommendations(trackId, numOfSongs, tempo, energy) {
  try {
    console.log(numOfSongs + '  ' + tempo + '  ' + energy);
    let url = `https://api.spotify.com/v1/recommendations?seed_tracks=${trackId}&limit=${numOfSongs}`;
    
    if (tempo) {
      url += `&target_tempo=${tempo}`;
    }
    if (energy) {
      url += `&target_energy=${energy}`;
    }

    const response = await fetch(url, {
      method: "get",
      headers: {
        Authorization: "Bearer " + global.access_token,
      },
    });

    if (response.ok) {
      const data = await response.json();
      return data.tracks;
    } else {
      const errorData = await response.json();
      throw new Error(
        `Failed to fetch recommendations. Status: ${
          response.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    throw new Error(`Error fetching recommendations: ${error.message}`);
  }
}


//  song recommendations based on top artist
app.get("/newplaylistartist", async (req, res) => {
  try {

    const numOfSongs = req.session.numOfSongs || 20; // Default to 20 if not set
    const tempo = req.session.tempo || null;
    const energy = req.session.energy || null;

    // Get the user's Spotify ID
    const spotifyUserId = await getUserProfile(global.access_token);

    // Get the user's 5 most listened to artist
    const topArtist = await getData(
      "/me/top/artists?time_range=medium_term&limit=5&offset=0"
    );

    // get list of artist IDs
    const artistList =
      topArtist.items[0].id +
      "%2C" +
      topArtist.items[1].id +
      "%2C" +
      topArtist.items[2].id +
      "%2C" +
      topArtist.items[3].id +
      "%2C" +
      topArtist.items[4].id;

    // Get song recommendations based on the artist IDs
    const recommendations = await getRecommendationsArtist(artistList, numOfSongs, tempo, energy);

    // Create an empty playlist
    const playlistResponse = await fetch(
      "https://api.spotify.com/v1/users/" + spotifyUserId + "/playlists",
      {
        method: "post",
        headers: {
          "Content-type": "application/json",
          Authorization: "Bearer " + global.access_token,
        },
        body: JSON.stringify({
          name: "Recs from most listened to Artist",
          description:
            "New Playlist from MusicMatcher - Based on your most played artist",
          public: false,
        }),
      }
    );

    if (playlistResponse.ok) {
      const playlistData = await playlistResponse.json();

      // Extract the playlist ID from the response
      const playlistId = playlistData.id;

      // Add recommended tracks to the playlist
      const addTracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "post",
          headers: {
            "Content-type": "application/json",
            Authorization: "Bearer " + global.access_token,
          },
          body: JSON.stringify({
            uris: recommendations.map((track) => track.uri),
          }),
        }
      );

      if (addTracksResponse.ok) {
        res.render("newplaylistartist", { playlist: playlistData, artist: topArtist.items });
        console.log("Playlist created successfully:", playlistData);
      } else {
        const errorData = await addTracksResponse.json();
        throw new Error(
          `Failed to add tracks to the playlist. Status: ${
            addTracksResponse.status
          }, Error: ${JSON.stringify(errorData)}`
        );
      }
    } else {
      const errorData = await playlistResponse.json();
      throw new Error(
        `Failed to create playlist. Status: ${
          playlistResponse.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating playlist");
  }
});

//recommendations based on top artist list
async function getRecommendationsArtist(artistIDs, numOfSongs, tempo, energy) {
  try {

    let url = `https://api.spotify.com/v1/recommendations?seed_artists=${artistIDs}&limit=${numOfSongs}`;
    
    if (tempo) {
      url += `&target_tempo=${tempo}`;
    }
    if (energy) {
      url += `&target_energy=${energy}`;
    }

    const response = await fetch(
      url,
      {
        method: "get",
        headers: {
          Authorization: "Bearer " + global.access_token,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.tracks;
    } else {
      const errorData = await response.json();
      throw new Error(
        `Failed to fetch recommendations. Status: ${
          response.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    throw new Error(
      `Error fetching recommendations from artist: ${error.message}`
    );
  }
}

//  song recommendations based on top songs
app.get("/newplaylistsongs", async (req, res) => {
  try {

    const numOfSongs = req.session.numOfSongs || 20; // Default to 20 if not set
    const tempo = req.session.tempo || null;
    const energy = req.session.energy || null;

    // Get the user's Spotify ID
    const spotifyUserId = await getUserProfile(global.access_token);

    // Get the user's 5 most listened to artist
    const topSong = await getData(
      "/me/top/tracks?time_range=medium_term&limit=5&offset=0"
    );

    // get list of song IDs
    const songList =
      topSong.items[0].id +
      "%2C" +
      topSong.items[1].id +
      "%2C" +
      topSong.items[2].id +
      "%2C" +
      topSong.items[3].id +
      "%2C" +
      topSong.items[4].id;

    // Get song recommendations based on the artist IDs
    const recommendations = await getRecommendationsSong(songList, numOfSongs, tempo, energy);

    // Create an empty playlist
    const playlistResponse = await fetch(
      "https://api.spotify.com/v1/users/" + spotifyUserId + "/playlists",
      {
        method: "post",
        headers: {
          "Content-type": "application/json",
          Authorization: "Bearer " + global.access_token,
        },
        body: JSON.stringify({
          name: "Recs from most listened to Songs",
          description:
            "New Playlist from MusicMatcher - Based on your most played songs",
          public: false,
        }),
      }
    );

    if (playlistResponse.ok) {
      const playlistData = await playlistResponse.json();

      // Extract the playlist ID from the response
      const playlistId = playlistData.id;

      // Add recommended tracks to the playlist
      const addTracksResponse = await fetch(
        `https://api.spotify.com/v1/playlists/${playlistId}/tracks`,
        {
          method: "post",
          headers: {
            "Content-type": "application/json",
            Authorization: "Bearer " + global.access_token,
          },
          body: JSON.stringify({
            uris: recommendations.map((track) => track.uri),
          }),
        }
      );

      if (addTracksResponse.ok) {
        res.render("newplaylisttopsongs", { playlist: playlistData, songs: topSong.items });
        console.log("Playlist created successfully:", playlistData);
      } else {
        const errorData = await addTracksResponse.json();
        throw new Error(
          `Failed to add tracks to the playlist. Status: ${
            addTracksResponse.status
          }, Error: ${JSON.stringify(errorData)}`
        );
      }
    } else {
      const errorData = await playlistResponse.json();
      throw new Error(
        `Failed to create playlist. Status: ${
          playlistResponse.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Error creating playlist");
  }
});

//recommendations based on top song list
async function getRecommendationsSong(songIDs, numOfSongs, tempo, energy) {
  try {

    let url = `https://api.spotify.com/v1/recommendations?seed_tracks=${songIDs}&max_popularity=50&limit=${numOfSongs}`;
    
    if (tempo) {
      url += `&target_tempo=${tempo}`;
    }
    if (energy) {
      url += `&target_energy=${energy}`;
    }

    const response = await fetch(
      url,
      {
        method: "get",
        headers: {
          Authorization: "Bearer " + global.access_token,
        },
      }
    );

    if (response.ok) {
      const data = await response.json();
      return data.tracks;
    } else {
      const errorData = await response.json();
      throw new Error(
        `Failed to fetch recommendations. Status: ${
          response.status
        }, Error: ${JSON.stringify(errorData)}`
      );
    }
  } catch (error) {
    throw new Error(
      `Error fetching recommendations from songs: ${error.message}`
    );
  }
}

// Add this route after your existing routes
app.get("/search", async (req, res) => {
  const query = req.query.query;
  const matchingPlaylists = await searchPlaylists(query);

  res.render("search", { playlists: matchingPlaylists, query });
});

// Define a function to get user's playlists
async function getUserPlaylists() {
  try {
    const playlists = await getData("/me/playlists?limit=50&offset=0");
    
    return playlists.items || []; 
  } catch (err) {
    console.error('Error fetching user playlists:', err);
    return []; 
  }
}

// Define a function to search for playlists
async function searchPlaylists(query) {
  try {
    const playlists = await getUserPlaylists();
    
    const filteredPlaylists = playlists.filter(playlist =>
      playlist.name.toLowerCase().includes(query.toLowerCase())
    );  
    return filteredPlaylists;
  } catch (err) {
    console.error('Error searching playlists:', err);
    return []; // Return an empty array in case of an error
  }

  
}

app.get('/search', async (req, res) => {
  const query = req.query.q; 
  
  // Call the searchPlaylists function passing the query
  const playlists = await searchPlaylists(query);
  
  // Render the search.pug template with the playlists data
  res.render('search', { query, playlists });

  
});
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, function () {
  console.log(
    `Your app is listening on http://localhost:${server.address().port}`
  );
});
