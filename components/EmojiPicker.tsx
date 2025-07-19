'use client';

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Search, Smile } from 'lucide-react';

// Emoji data with searchable names and keywords
const EMOJI_DATA = {
  'Smileys & People': [
    { emoji: '😀', names: ['grinning', 'happy', 'smile', 'face'] },
    { emoji: '😃', names: ['grinning', 'happy', 'smile', 'joy'] },
    { emoji: '😄', names: ['grinning', 'happy', 'smile', 'laugh'] },
    { emoji: '😁', names: ['grinning', 'happy', 'smile', 'teeth'] },
    { emoji: '😊', names: ['smiling', 'happy', 'blush', 'pleased'] },
    { emoji: '😍', names: ['heart-eyes', 'love', 'crush', 'infatuated'] },
    { emoji: '🤩', names: ['star-eyes', 'excited', 'amazed', 'wow'] },
    { emoji: '😎', names: ['sunglasses', 'cool', 'confident'] },
    { emoji: '🤓', names: ['nerd', 'glasses', 'smart', 'geek'] },
    { emoji: '🧐', names: ['monocle', 'thinking', 'curious'] },
    { emoji: '🤗', names: ['hugging', 'hug', 'embrace'] },
    { emoji: '😌', names: ['relieved', 'peaceful', 'calm'] },
    { emoji: '😇', names: ['innocent', 'angel', 'halo'] },
    { emoji: '😂', names: ['joy', 'laugh', 'tears', 'funny'] },
    { emoji: '🤣', names: ['rolling', 'laugh', 'funny', 'hilarious'] },
    { emoji: '😉', names: ['wink', 'flirt', 'playful'] },
    { emoji: '😋', names: ['yum', 'delicious', 'tasty'] },
    { emoji: '😜', names: ['winking', 'tongue', 'playful'] },
    { emoji: '🤪', names: ['zany', 'crazy', 'wild'] },
    { emoji: '😏', names: ['smirk', 'smug', 'confident'] },
    { emoji: '🤖', names: ['robot', 'bot', 'ai', 'artificial', 'machine'] },
    { emoji: '👨‍💻', names: ['programmer', 'developer', 'coder', 'man', 'computer'] },
    { emoji: '👩‍💻', names: ['programmer', 'developer', 'coder', 'woman', 'computer'] },
    { emoji: '🧠', names: ['brain', 'smart', 'intelligence', 'think'] },
    { emoji: '👍', names: ['thumbs-up', 'like', 'approve', 'good'] },
    { emoji: '👎', names: ['thumbs-down', 'dislike', 'bad'] }
  ],
  'Animals & Nature': [
    { emoji: '🐶', names: ['dog', 'puppy', 'pet', 'animal'] },
    { emoji: '🐱', names: ['cat', 'kitten', 'pet', 'animal'] },
    { emoji: '🐭', names: ['mouse', 'rodent', 'small'] },
    { emoji: '🐹', names: ['hamster', 'pet', 'rodent'] },
    { emoji: '🐰', names: ['rabbit', 'bunny', 'easter'] },
    { emoji: '🦊', names: ['fox', 'clever', 'orange'] },
    { emoji: '🐻', names: ['bear', 'animal', 'brown'] },
    { emoji: '🐼', names: ['panda', 'bear', 'china'] },
    { emoji: '🐨', names: ['koala', 'australia', 'bear'] },
    { emoji: '🐯', names: ['tiger', 'cat', 'stripes'] },
    { emoji: '🦁', names: ['lion', 'king', 'mane'] },
    { emoji: '🐮', names: ['cow', 'moo', 'milk'] },
    { emoji: '🐷', names: ['pig', 'oink', 'farm'] },
    { emoji: '🐸', names: ['frog', 'green', 'ribbit'] },
    { emoji: '🐵', names: ['monkey', 'banana', 'primate'] },
    { emoji: '🐔', names: ['chicken', 'rooster', 'farm'] },
    { emoji: '🐧', names: ['penguin', 'antarctica', 'bird'] },
    { emoji: '🦋', names: ['butterfly', 'beautiful', 'wings'] },
    { emoji: '🐝', names: ['bee', 'honey', 'buzz'] },
    { emoji: '🦄', names: ['unicorn', 'magical', 'horn'] }
  ],
  'Objects & Symbols': [
    { emoji: '💻', names: ['laptop', 'computer', 'work', 'tech'] },
    { emoji: '⌨️', names: ['keyboard', 'typing', 'computer'] },
    { emoji: '🖥️', names: ['desktop', 'computer', 'monitor'] },
    { emoji: '🖱️', names: ['mouse', 'computer', 'click'] },
    { emoji: '📱', names: ['phone', 'mobile', 'smartphone'] },
    { emoji: '⚡', names: ['lightning', 'electric', 'power', 'fast'] },
    { emoji: '🔥', names: ['fire', 'hot', 'flame', 'lit'] },
    { emoji: '💧', names: ['water', 'drop', 'liquid'] },
    { emoji: '⭐', names: ['star', 'favorite', 'rating'] },
    { emoji: '✨', names: ['sparkles', 'magic', 'shine'] },
    { emoji: '🌟', names: ['star', 'glowing', 'special'] },
    { emoji: '🔮', names: ['crystal-ball', 'fortune', 'magic'] },
    { emoji: '💎', names: ['diamond', 'gem', 'valuable'] },
    { emoji: '🏆', names: ['trophy', 'winner', 'award'] },
    { emoji: '🎖️', names: ['medal', 'military', 'honor'] },
    { emoji: '🏅', names: ['medal', 'sports', 'winner'] },
    { emoji: '🥇', names: ['gold', 'first', 'winner'] }
  ],
  'Activities & Hobbies': [
    { emoji: '🎨', names: ['art', 'paint', 'creative', 'artist'] },
    { emoji: '🖌️', names: ['paintbrush', 'art', 'paint'] },
    { emoji: '📝', names: ['memo', 'write', 'note', 'pencil'] },
    { emoji: '📚', names: ['books', 'study', 'education', 'read'] },
    { emoji: '📖', names: ['book', 'read', 'open'] },
    { emoji: '🔬', names: ['microscope', 'science', 'research'] },
    { emoji: '🔭', names: ['telescope', 'astronomy', 'space'] },
    { emoji: '🎵', names: ['music', 'note', 'musical'] },
    { emoji: '🎶', names: ['music', 'notes', 'melody'] },
    { emoji: '🎤', names: ['microphone', 'sing', 'karaoke'] },
    { emoji: '🎧', names: ['headphones', 'music', 'listen'] },
    { emoji: '🎹', names: ['piano', 'keyboard', 'music'] },
    { emoji: '🎸', names: ['guitar', 'music', 'rock'] },
    { emoji: '🎯', names: ['target', 'goal', 'aim', 'bullseye'] },
    { emoji: '🎲', names: ['dice', 'game', 'luck', 'random'] }
  ],
  'Food & Drink': [
    { emoji: '🍎', names: ['apple', 'fruit', 'red', 'healthy'] },
    { emoji: '🍌', names: ['banana', 'fruit', 'yellow'] },
    { emoji: '🍇', names: ['grapes', 'fruit', 'wine'] },
    { emoji: '🍓', names: ['strawberry', 'fruit', 'red'] },
    { emoji: '🍒', names: ['cherries', 'fruit', 'red'] },
    { emoji: '🍍', names: ['pineapple', 'fruit', 'tropical'] },
    { emoji: '🍞', names: ['bread', 'loaf', 'carbs'] },
    { emoji: '🧀', names: ['cheese', 'dairy', 'yellow'] },
    { emoji: '🥚', names: ['egg', 'breakfast', 'protein'] },
    { emoji: '🍳', names: ['cooking', 'fried-egg', 'breakfast'] },
    { emoji: '☕', names: ['coffee', 'drink', 'caffeine', 'hot'] },
    { emoji: '🍵', names: ['tea', 'drink', 'hot', 'green'] },
    { emoji: '🍺', names: ['beer', 'drink', 'alcohol'] },
    { emoji: '🍷', names: ['wine', 'drink', 'alcohol', 'red'] }
  ],
  'Travel & Places': [
    { emoji: '🚗', names: ['car', 'automobile', 'vehicle'] },
    { emoji: '🚕', names: ['taxi', 'cab', 'yellow'] },
    { emoji: '🚙', names: ['suv', 'car', 'blue'] },
    { emoji: '🚌', names: ['bus', 'public', 'transport'] },
    { emoji: '✈️', names: ['airplane', 'plane', 'flight', 'travel'] },
    { emoji: '🚀', names: ['rocket', 'space', 'launch', 'fast'] },
    { emoji: '🛸', names: ['ufo', 'alien', 'spaceship'] },
    { emoji: '🏠', names: ['house', 'home', 'building'] },
    { emoji: '🏢', names: ['office', 'building', 'work'] },
    { emoji: '🏰', names: ['castle', 'palace', 'medieval'] },
    { emoji: '🗽', names: ['statue-of-liberty', 'new-york', 'freedom'] }
  ]
};

// Extract all emojis and create search index
const ALL_EMOJI_DATA = Object.values(EMOJI_DATA).flat();
const EMOJI_CATEGORIES = Object.fromEntries(
  Object.entries(EMOJI_DATA).map(([category, emojis]) => [
    category, 
    emojis.map(item => item.emoji)
  ])
);

// Common/popular emojis to show first
const POPULAR_EMOJIS = [
  '🤖', '😀', '😊', '🎉', '❤️', '👍', '🔥', '✨', '💡', '⭐',
  '🚀', '💻', '📚', '🎯', '🏆', '🎨', '🌟', '💎', '🧠', '👨‍💻'
];

interface EmojiPickerProps {
  value?: string
  onSelect: (emoji: string) => void
  placeholder?: string
}

export function EmojiPicker({ value, onSelect, placeholder = 'Pick an emoji' }: EmojiPickerProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  // Filter emojis based on search
  const filteredEmojis = useMemo(() => {
    if (!search) {
      return { 'Popular': POPULAR_EMOJIS, ...EMOJI_CATEGORIES };
    }
    
    // Search by emoji names and keywords
    const searchLower = search.toLowerCase();
    const filtered = ALL_EMOJI_DATA.filter(item => {
      // Check if search term matches any of the emoji's names
      return item.names.some(name => name.includes(searchLower));
    }).map(item => item.emoji);
    
    return filtered.length > 0 ? { 'Search Results': filtered } : {};
  }, [search]);

  const handleEmojiSelect = (emoji: string) => {
    onSelect(emoji);
    setOpen(false);
    setSearch('');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button 
          variant="outline" 
          className="w-full justify-start h-10 px-3"
          type="button"
        >
          {value ? (
            <span className="flex items-center gap-2">
              <span className="text-lg">{value}</span>
              <span className="text-sm text-muted-foreground">Click to change</span>
            </span>
          ) : (
            <span className="flex items-center gap-2 text-muted-foreground">
              <Smile className="h-4 w-4" />
              {placeholder}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      
      <PopoverContent className="w-80 p-0 max-h-[500px]" align="start">
        <div className="p-4 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
            <Input
              placeholder="Search emojis..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8"
            />
          </div>
        </div>
        
        <div className="relative">
          <div 
            className="h-80 overflow-y-scroll p-4 bg-background"
            style={{ 
              height: '320px',
              overflowY: 'scroll',
              scrollBehavior: 'smooth'
            }}
            onWheel={(e) => {
              // Ensure wheel events are handled properly
              e.stopPropagation();
            }}
          >
            <div className="min-h-[800px]">
              {Object.keys(filteredEmojis).length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No emojis found</p>
                  <p className="text-xs mt-1">Try a different search term</p>
                </div>
              ) : (
                Object.entries(filteredEmojis).map(([category, emojis]) => (
                  <div key={category} className="mb-6">
                    <h3 className="text-sm font-medium text-muted-foreground mb-2 sticky top-0 bg-background py-1">
                      {category}
                    </h3>
                    <div className="grid grid-cols-8 gap-1">
                      {emojis.map((emoji, index) => (
                        <Button
                          key={`${emoji}-${index}`}
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 hover:bg-muted"
                          onClick={() => handleEmojiSelect(emoji)}
                        >
                          <span className="text-lg">{emoji}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
        
        {value && (
          <div className="p-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleEmojiSelect('')}
              className="w-full"
            >
              Remove Emoji
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}