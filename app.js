


const express = require('express');

const app = express();

app.set("views", "./views");
app.set("view engine", "pug");

app.use(express.static("public"));

const redirect_uri ="http://localhost:3000/callback";
const client_id = "33c3a45c1db24e6aa74fe79b268eadfb";
const client_secret = "21f632a9010a4c8782466d22eec429ef"

app.get("/", function (req, res){
    res.render("index");
});

app.get("/authorize", (req, res) => {
   var auth_query_parameters = new URLSearchParams ({
    response_type: "code",
    client_id: client_id,
    scope: "user-library-read, playlist-read-private, playlist-modify-public, playlist-modify-private, user-top-read",
    redirect_uri: redirect_uri
  }) 

  res.redirect("https://accounts.spotify.com/authorize?" + auth_query_parameters.toString());

});

app.get("/callback", async(req, res) => {
    const code = req.query.code;
    
    var body = new URLSearchParams ({
        code: code,
        redirect_uri: redirect_uri,
        grant_type: "authorization_code"

    })

    const response = await fetch('https://accounts.spotify.com/api/token', {
        method: "post",
        body: body,
        headers: {
            "Content-type": "application/x-www-form-urlencoded",
            "Authorization": "Basic " +  
             Buffer.from(client_id + ":" + client_secret).toString("base64"),
        }
    })

    const data = await response.json();
    global.access_token = data.access_token;

    res.redirect("/dashboard")
 });
async function getData(endpoint) {
    const response = await fetch("https://api.spotify.com/v1" + endpoint, {
        method: "get",
        headers: {
            Authorization: "Bearer " + global.access_token
        }
    });
    const data = await response.json();
    return data;
}


 app.get("/dashboard", async(req, res) => { 
  
    const userInfo = await getData('/me');
    const tracks = await getData('/me/tracks?limit=10');

    res.render("dashboard", {user: userInfo, tracks: tracks.items});

 });

 app.get("/recommendations", async(req, res) => { 
    const artist_id = req.query.artist;
    const track_id = req.query.track;
    const params = new URLSearchParams({
        seed_artist: artist_id,
        seed_tracks: track_id,
    })
    
    const data = await getData('/recommendations?' + params);
    
    res.render("recommendation", {tracks: data.tracks})
 })

 app.get("/playlist", async(req, res) => { 
  
    const playlist = await getData('/me/playlists?limit=5&offset=0');

    res.render("playlist", {playlist: playlist.items});
    

 });

 async function getUserProfile(access_token) {
    const response = await fetch('https://api.spotify.com/v1/me', {
        method: "get",
        headers: {
            "Authorization": "Bearer " + access_token
        }
    });

    if (response.ok) {
        const data = await response.json();
        return data.id; // Extract the user's Spotify ID from the response
    } else {
        throw new Error("Failed to fetch user profile");
    }
}

 app.get("/newplaylist", async (req, res) => {
    try {

         // Get the user's Spotify ID
        const spotifyUserId = await getUserProfile(global.access_token);
        

        // Get the user's liked songs
        const likedSongs = await getData('/me/tracks?limit=50');

        // Extract the first track ID from liked songs
        const firstTrackId = likedSongs.items[0].track.id;

        // Get song recommendations based on the first track ID
        const recommendations = await getRecommendations(firstTrackId);

        // Create an empty playlist
        const playlistResponse = await fetch('https://api.spotify.com/v1/users/' + spotifyUserId +'/playlists', {
            method: "post",
            headers: {
                "Content-type": "application/json",
                "Authorization": "Bearer " + global.access_token,
            },
            body: JSON.stringify({
                "name": "New Playlist",
                "description": "New Playlist from MusicMatcher - Based on your most recently liked song",
                "public": false
            })
        });

        if (playlistResponse.ok) {
            const playlistData = await playlistResponse.json();
            
            // Extract the playlist ID from the response
            const playlistId = playlistData.id;

            // Add recommended tracks to the playlist
            const addTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                method: "post",
                headers: {
                    "Content-type": "application/json",
                    "Authorization": "Bearer " + global.access_token,
                },
                body: JSON.stringify({
                    uris: recommendations.map(track => track.uri)
                })
            });

            if (addTracksResponse.ok) {
                res.render("newplaylist", { playlist: playlistData });
                console.log("Playlist created successfully:", playlistData);
            } else {
                const errorData = await addTracksResponse.json();
                throw new Error(`Failed to add tracks to the playlist. Status: ${addTracksResponse.status}, Error: ${JSON.stringify(errorData)}`);
            }
        } else {
            const errorData = await playlistResponse.json();
            throw new Error(`Failed to create playlist. Status: ${playlistResponse.status}, Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Error creating playlist");
    }
});

// track recommendations
async function getRecommendations(trackId) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_tracks=${trackId}`, {
            method: "get",
            headers: {
                "Authorization": "Bearer " + global.access_token
            }
        });

        if (response.ok) {
            const data = await response.json();
            return data.tracks;
        } else {
            const errorData = await response.json();
            throw new Error(`Failed to fetch recommendations. Status: ${response.status}, Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        throw new Error(`Error fetching recommendations: ${error.message}`);
    }
}

// get top artist

async function getArtist() {
    try {
        const response = await fetch('https://api.spotify.com/v1/me/top/artists?&limit=5&offset=0', {
            method: "get",
            headers: {
                "Authorization": "Bearer " + global.access_token
            }
        });

        if (response.ok) {
            const data = await response.json();
            return data.items;
        } else {
            const errorData = await response.json();
            throw new Error(`Failed to fetch top artist. Status: ${response.status}, Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        throw new Error(`Error fetching top artist: ${error.message}`);
    }
}

//  song recommendations based on top artist
app.get("/newplaylistartist", async (req, res) => {
    try {

         // Get the user's Spotify ID
        const spotifyUserId = await getUserProfile(global.access_token);
        
        // Get the user's 5 most listened to artist
        const topArtist = await getData('/me/top/artists?time_range=medium_term&limit=5&offset=0');

        // get list of artist IDs
        const artistList = topArtist.items[0].id + "%2C" + topArtist.items[1].id + "%2C" + topArtist.items[2].id + "%2C" + topArtist.items[3].id + "%2C" + topArtist.items[4].id;

        // Get song recommendations based on the artist IDs
        const recommendations = await getRecommendationsArtist(artistList);

        // Create an empty playlist
        const playlistResponse = await fetch('https://api.spotify.com/v1/users/' + spotifyUserId +'/playlists', {
            method: "post",
            headers: {
                "Content-type": "application/json",
                "Authorization": "Bearer " + global.access_token,
            },
            body: JSON.stringify({
                "name": "Recs from Top Artist",
                "description": "New Playlist from MusicMatcher - Based on your most played artist",
                "public": false
            })
        });

        if (playlistResponse.ok) {
            const playlistData = await playlistResponse.json();
            
            // Extract the playlist ID from the response
            const playlistId = playlistData.id;

            // Add recommended tracks to the playlist
            const addTracksResponse = await fetch(`https://api.spotify.com/v1/playlists/${playlistId}/tracks`, {
                method: "post",
                headers: {
                    "Content-type": "application/json",
                    "Authorization": "Bearer " + global.access_token,
                },
                body: JSON.stringify({
                    uris: recommendations.map(track => track.uri)
                })
            });

            if (addTracksResponse.ok) {
                res.render("newplaylist", { playlist: playlistData });
                console.log("Playlist created successfully:", playlistData);
            } else {
                const errorData = await addTracksResponse.json();
                throw new Error(`Failed to add tracks to the playlist. Status: ${addTracksResponse.status}, Error: ${JSON.stringify(errorData)}`);
            }
        } else {
            const errorData = await playlistResponse.json();
            throw new Error(`Failed to create playlist. Status: ${playlistResponse.status}, Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        console.error(error);
        res.status(500).send("Error creating playlist");
    }
});

//recommendations based on top artist list
async function getRecommendationsArtist(artistIDs) {
    try {
        const response = await fetch(`https://api.spotify.com/v1/recommendations?seed_artists=${artistIDs}`, {
            method: "get",
            headers: {
                "Authorization": "Bearer " + global.access_token
            }
        });

        if (response.ok) {
            const data = await response.json();
            return data.tracks;
        } else {
            const errorData = await response.json();
            throw new Error(`Failed to fetch recommendations. Status: ${response.status}, Error: ${JSON.stringify(errorData)}`);
        }
    } catch (error) {
        throw new Error(`Error fetching recommendations from artist: ${error.message}`);
    }
}


let listener = app.listen(3000, function () {
console.log("your app is listening on http://localhost:" + 
listener.address().port);
});