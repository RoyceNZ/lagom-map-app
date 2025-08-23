import { Component } from '@angular/core';
import { SquareMapComponent } from './square-map/square-map.component';
import { NewsBannerComponent } from './news-banner/news-banner.component';

@Component({
  selector: 'app-root',
  imports: [SquareMapComponent, NewsBannerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'lagom-map-app';
}
