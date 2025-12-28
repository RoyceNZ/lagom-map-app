import { Component } from '@angular/core';
import { SquareMapComponent } from './square-map/square-map.component';

@Component({
  selector: 'app-root',
  imports: [SquareMapComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'lagom-map-app';
}
