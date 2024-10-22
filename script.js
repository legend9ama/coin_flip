// script.js

const startButton = document.getElementById('start-button');
const coinDisplay = document.getElementById('coin-display');
const resultDisplay = document.getElementById('result');
const messageDisplay = document.getElementById('message');
const playerChoices = document.getElementById('player-choices');
const flipButton = document.getElementById('flip-button');
const dontFlipButton = document.getElementById('dont-flip-button');

let coinState = 'Heads'; // Initial state of the coin
let playerChoice1 = '';
let playerChoice2 = '';
let computerChoice1 = '';
let computerChoice2 = '';

startButton.addEventListener('click', async () => {
    // Show initial state
    coinDisplay.style.display = 'block'; // Ensure the coin display is visible
    coinDisplay.src = 'images/coin_heads.png'; // Show heads image
    coinDisplay.style.opacity = 1; // Start with full opacity
    resultDisplay.textContent = '';
    messageDisplay.textContent = '';

    // Hide the Start button
    startButton.style.display = 'none';

    // Fade out the coin
    await fadeOutCoin(); // Fade out the coin
    await delay(500); // Wait briefly before showing question mark

    // Replace with question mark
    coinDisplay.src = 'images/question_mark.png'; // Replace with question mark
    coinDisplay.style.opacity = 1; // Ensure question mark is fully visible

    // First turn: Computer's choice
    messageDisplay.textContent = "Computer is thinking...";
    await delay(3000); // Computer thinking delay
    computerChoice1 = Math.random() < 0.5 ? 'Flip' : 'Don\'t Flip'; // Random choice

    // Apply computer's first choice
    if (computerChoice1 === 'Flip') {
        coinState = coinState === 'Heads' ? 'Tails' : 'Heads'; // Flip the coin state
    }

    // Second turn: Player's first choice
    await delay(300); // Pause before showing player's turn
    messageDisplay.textContent = "It's your turn to make a move!";
    playerChoices.style.display = 'flex'; // Show player buttons

    // Player makes their first choice
    await playerMakesChoice1();

    // Second round: Computer's second turn
    messageDisplay.textContent = "Computer is thinking...";
    await delay(3000); // Computer thinking delay
    computerChoice2 = Math.random() < 0.5 ? 'Flip' : 'Don\'t Flip'; // Random choice

    // Apply computer's second choice
    if (computerChoice2 === 'Flip') {
        coinState = coinState === 'Heads' ? 'Tails' : 'Heads'; // Flip the coin state again
    }

    // Second turn: Player's second choice
    await delay(300); // Pause before showing player's second turn
    messageDisplay.textContent = "It's your turn to make a move again!";
    playerChoices.style.display = 'flex'; // Show player buttons again

    // Player makes their second choice
    await playerMakesChoice2();

    await showResult(); // Call showResult with await to allow fading
});

// Function for player making the first choice
async function playerMakesChoice1() {
    return new Promise((resolve) => {
        flipButton.onclick = () => {
            playerChoice1 = 'Flip'; // Player chooses to flip
            if (coinState === 'Heads') {
                coinState = 'Tails'; // Flip the coin state
            } else {
                coinState = 'Heads'; // Flip the coin state
            }
            playerChoices.style.display = 'none'; // Hide buttons
            resolve();
        };
        dontFlipButton.onclick = () => {
            playerChoice1 = "Don't Flip"; // Player chooses not to flip
            playerChoices.style.display = 'none'; // Hide buttons
            resolve();
        };
    });
}

async function playerMakesChoice2() {
    return new Promise((resolve) => {
        flipButton.onclick = () => {
            playerChoice2 = 'Flip'; // Player chooses to flip
            if (coinState === 'Heads') {
                coinState = 'Tails'; // Flip the coin state
            } else {
                coinState = 'Heads'; // Flip the coin state
            }
            playerChoices.style.display = 'none'; // Hide buttons
            resolve();
        };
        dontFlipButton.onclick = () => {
            playerChoice2 = "Don't Flip"; // Player chooses not to flip
            playerChoices.style.display = 'none'; // Hide buttons
            resolve();
        };
    });
}

// Function to show the final result
async function showResult() {
    // Show the coin display with the final state
    coinDisplay.style.display = 'block'; // Ensure the coin is visible
    messageDisplay.textContent = '';
    

    await fadeOutCoin(); // Fade out the coin
    await delay(500);
    coinDisplay.src = coinState === 'Heads' ? 'images/coin_heads.png' : 'images/coin_tails.png'; // Show final coin state
    coinDisplay.style.transition = 'opacity 0.5s ease'; // Smooth transition for fading
    coinDisplay.style.opacity = 1; // Fade in the coin
    // Determine the winner based on the final coin state
    const playerWins = coinState === 'Tails'; // Player wins if the coin is Tails
    const computerWins = coinState === 'Heads'; // Computer wins if the coin is Heads
    const winner = computerWins ? 'Computer wins!' : 'You win!';

    resultDisplay.textContent = winner;

    // Send game result to the backend
    await sendGameResult(playerWins, computerWins);

    // Clear the message display
}
async function sendGameResult(playerWins, computerWins) {
    try {
        const response = await fetch('https://coin-flip-backend-647009581501.europe-north1.run.app/game', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                playerWins: playerWins,
                computerWins: computerWins
            })
        });
        
        if (!response.ok) {
            throw new Error('Failed to send game result');
        }
    } catch (error) {
        console.error('Error sending game result:', error);
    }
}

// Utility function for delays
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to fade out the coin
async function fadeOutCoin() {
    coinDisplay.style.transition = 'opacity 0.5s ease'; // Set transition for fading
    coinDisplay.style.opacity = 0; // Start fading out
    await delay(500); // Wait for fade-out effect to finish
}
