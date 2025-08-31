import { isValidWord, getRandomAnswer } from './all-words.js';

export class WordleGame {
  constructor(targetWord = null) {
    // Use comprehensive all-English-words validation
    this.targetWord = targetWord || this.getRandomWord();
    this.guesses = [];
    this.maxGuesses = 6;
    this.gameOver = false;
    this.won = false;
  }

  getRandomWord() {
    return getRandomAnswer();
  }

  makeGuess(word) {
    if (this.gameOver) {
      return { error: 'Game is already over' };
    }

    word = word.toUpperCase();
    
    if (word.length !== 5) {
      return { error: 'Word must be 5 letters long' };
    }

    if (!this.isValidWord(word)) {
      return { error: 'Not a valid word' };
    }

    const result = this.evaluateGuess(word);
    this.guesses.push({ word, result });

    if (word === this.targetWord) {
      this.gameOver = true;
      this.won = true;
    } else if (this.guesses.length >= this.maxGuesses) {
      this.gameOver = true;
      this.won = false;
    }

    return {
      word,
      result,
      gameOver: this.gameOver,
      won: this.won,
      guessNumber: this.guesses.length,
      targetWord: this.gameOver ? this.targetWord : null
    };
  }

  evaluateGuess(word) {
    const result = {
      correct: [],
      wrong_position: [],
      not_in_word: []
    };
    
    const targetLetters = this.targetWord.split('');
    const guessLetters = word.split('');
    const tempTarget = [...targetLetters];
    const tempGuess = [...guessLetters];
    
    // First pass: find correct positions
    for (let i = 0; i < 5; i++) {
      if (guessLetters[i] === targetLetters[i]) {
        result.correct.push({ position: i, letter: guessLetters[i] });
        tempTarget[i] = null;
        tempGuess[i] = null;
      }
    }
    
    // Second pass: find wrong positions and not in word
    for (let i = 0; i < 5; i++) {
      if (tempGuess[i] !== null) {
        const targetIndex = tempTarget.indexOf(tempGuess[i]);
        if (targetIndex !== -1) {
          result.wrong_position.push({ position: i, letter: tempGuess[i] });
          tempTarget[targetIndex] = null;
        } else {
          result.not_in_word.push({ position: i, letter: tempGuess[i] });
        }
      }
    }
    
    return result;
  }

  isValidWord(word) {
    return isValidWord(word);
  }

  getGameState() {
    return {
      guesses: this.guesses,
      gameOver: this.gameOver,
      won: this.won,
      targetWord: this.gameOver ? this.targetWord : null,
      guessesRemaining: this.maxGuesses - this.guesses.length
    };
  }

  reset(newTarget = null) {
    this.targetWord = newTarget || this.getRandomWord();
    this.guesses = [];
    this.gameOver = false;
    this.won = false;
  }
}