import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-news-banner',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './news-banner.component.html',
  styleUrl: './news-banner.component.css'
})
export class NewsBannerComponent {
  isLoggedIn = false;
  showLoginModal = false;
  username = '';
  password = '';
  currentUser = '';

  constructor() {
    // Component initialization
  }

  toggleLoginModal() {
    this.showLoginModal = !this.showLoginModal;
    if (!this.showLoginModal) {
      this.username = '';
      this.password = '';
    }
  }

  login() {
    if (this.username && this.password) {
      this.isLoggedIn = true;
      this.currentUser = this.username;
      this.showLoginModal = false;
      this.username = '';
      this.password = '';
    }
  }

  logout() {
    this.isLoggedIn = false;
    this.currentUser = '';
  }

  getCurrentTime(): string {
    return new Date().toLocaleTimeString();
  }

  getCurrentDate(): string {
    return new Date().toLocaleDateString('en-US', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  }
}
